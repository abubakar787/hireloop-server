import express from "express";
import cors from "cors";
import 'dotenv/config'
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const port = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.xzqg4n6.mongodb.net/`,
);

export async function connectToMongoDB() {
  await client.connect();
  console.log("You successfully connected to MongoDB!");
  return client;
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("hireloopdb");
const users= database.collection("user");
const jobs = database.collection("jobs");
const applications = database.collection("applications")

// Database-level guarantee: one application per person per job. The route
// checks first for a friendly message; this index is the hard backstop that
// also closes the race window (two submits at the exact same moment).
await applications.createIndex({ jobId: 1, email: 1 }, { unique: true });

app.get("/", (req, res) => {
  res.send("Hire loop is running");
});


app.get('/users', async (req, res) =>{
    const cursor = users.find({});
    const result = await cursor.toArray();
    console.log("Total Users:", result.length);
    res.send(result);
   
})

app.get("/jobs/:id", async (req, res) => {
  const { id } = req.params;

  // Guard against malformed ids so findOne doesn't throw a CastError.
  if (!ObjectId.isValid(id)) {
    return res.status(404).send({ message: "Job not found" });
  }

  const result = await jobs.findOne({ _id: new ObjectId(id) });
  if (!result) {
    return res.status(404).send({ message: "Job not found" });
  }

  res.send(result);
});

//job application post
app.post('/applications', async (req, res) => {
  const { jobId, jobTitle, company, userId, fullName, email } = req.body;
  if (!jobId || !jobTitle || !company || !userId || !fullName || !email) {
    return res.status(400).send({
      message: "jobId, jobTitle, company, userId, fullName and email are required.",
    });
  }

  // One application per person per job: reject if this user already
  // applied to this job (409 = "conflict, already exists").
  const existing = await applications.findOne({ jobId, userId });
  if (existing) {
    return res.status(409).send({ message: "You have already applied for this job." });
  }

  const doc = {
    ...req.body,
    status: "applied",
    appliedAt: new Date(),
  };
  const result = await applications.insertOne(doc);
  res.status(201).send({ insertedId: result.insertedId });
});

// Applications for one seeker, newest first — powers the "My
// Applications" page. Look up by userId (stable) or email (legacy docs
// saved before userId existed).
app.get('/applications', async (req, res) => {
  const { email, userId } = req.query;
  if (!email && !userId) {
    return res.status(400).send({ message: "email or userId query param is required." });
  }
  const filter = userId
    ? { $or: [{ userId: String(userId) }, ...(email ? [{ email: String(email) }] : [])] }
    : { email: String(email) };
  const docs = await applications
    .find(filter)
    .sort({ appliedAt: -1, createdAt: -1 })
    .toArray();

  // Older documents (saved before jobTitle/company existed on the
  // application) are enriched from the jobs collection so the dashboard
  // always has a title + company to display.
  const missingJobIds = [
    ...new Set(
      docs
        .filter((d) => !d.jobTitle && ObjectId.isValid(d.jobId))
        .map((d) => d.jobId),
    ),
  ];
  if (missingJobIds.length > 0) {
    const jobsFound = await jobs
      .find({ _id: { $in: missingJobIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const jobById = new Map(jobsFound.map((j) => [String(j._id), j]));
    for (const doc of docs) {
      const job = jobById.get(String(doc.jobId));
      if (job) {
        doc.jobTitle = job.title;
        doc.company = job.company;
      }
    }
  }

  // Legacy documents also predate status/appliedAt — default them so the
  // API always returns the full shape.
  for (const doc of docs) {
    if (!doc.status) doc.status = "applied";
    if (!doc.appliedAt) doc.appliedAt = doc.createdAt;
  }

  res.send(docs);
});
 
//jobs related apis
app.get('/jobs', async (req, res) => {
  const query= {};

  console.log('query:', req.query);
  if(req.query){
    if(req.query.jobType){
      query.type = req.query.jobType;
    } 
    if(req.query.isRemote){
       query.isRemote = req.query.isRemote === 'true';
    }
    if(req.query.category){
      query.category = req.query.category;
    } 
    if(req.query.search){
      const search = req.query.search;
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { responsibilities: { $regex: search, $options: 'i' } },
        { requirements: { $regex: search, $options: 'i' } }
      ];
    }

  }


    const cursor = jobs.find({});
    const result = await cursor.toArray();
    console.log("Total Jobs:", result.length);
    res.send(result);
   
})

app.post('/jobs', async (req, res) => {
    const job = req.body;
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      return res.status(400).json({ message: "A job object is required." });
    }

    const requiredFields = [
      "title",
      "company",
      "category",
      "type",
      "location",
      "responsibilities",
      "requirements",
    ];
    const missingFields = requiredFields.filter(
      (field) => typeof job[field] !== "string" || !job[field].trim(),
    );

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Please provide: ${missingFields.join(", ")}.`,
      });
    }

    try {
      const document = {
        ...job,
        createdAt: new Date(),
        status: "active",
      };
      const result = await jobs.insertOne(document);

      return res.status(201).json({
        message: "Job created successfully.",
        jobId: result.insertedId,
      });
    } catch (error) {
      console.error("Failed to save job:", error);
      return res.status(500).json({ message: "Failed to save the job." });
    }
});

app.put("/jobs/:id", async (req, res) => {
  const { id } = req.params;
  const job = req.body;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "A valid job ID is required." });
  }

  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return res.status(400).json({ message: "Job details are required." });
  }

  const requiredFields = ["title", "company", "category", "type", "location"];
  const missingFields = requiredFields.filter(
    (field) => typeof job[field] !== "string" || !job[field].trim(),
  );

  if (missingFields.length > 0) {
    return res.status(400).json({
      message: `Please provide: ${missingFields.join(", ")}.`,
    });
  }

  try {
    const result = await jobs.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...job, updatedAt: new Date() } },
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Job not found." });
    }

    return res.status(200).json({ message: "Job updated successfully." });
  } catch (error) {
    console.error("Failed to update job:", error);
    return res.status(500).json({ message: "Failed to update the job." });
  }
});

app.delete("/jobs/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ message: "A valid job ID is required." });
  }

  try {
    const result = await jobs.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Job not found." });
    }

    return res.status(200).json({ message: "Job deleted successfully." });
  } catch (error) {
    console.error("Failed to delete job:", error);
    return res.status(500).json({ message: "Failed to delete the job." });
  }
});

app.listen(port, () => {
  console.log(`Hire loop server is running on port ${port}`);
});
