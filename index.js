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

app.get("/", (req, res) => {
  res.send("Hire loop is running");
});


app.get('/users', async (req, res) =>{
    const cursor = users.find({});
    const result = await cursor.toArray();
    console.log("Total Users:", result.length);
    res.send(result);
   
})
 
//jobs related apis
app.get('/jobs', async (req, res) => {
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
