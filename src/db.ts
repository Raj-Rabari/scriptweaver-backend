import mongoose from "mongoose";
import { config } from "./config.js";

mongoose.set("strictQuery", true);

export async function connectDb(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  console.log("MongoDB connected");
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
