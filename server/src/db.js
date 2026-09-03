import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDb() {
  try {
    await mongoose.connect(config.mongoUri);
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    console.error("Start MongoDB or set MONGODB_URI in server/.env");
    process.exit(1);
  }
}
