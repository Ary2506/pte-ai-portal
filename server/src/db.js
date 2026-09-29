import mongoose from "mongoose";
import { config } from "./config.js";

// Mongoose defaults maxPoolSize to 100. That is far too many sockets per process for a shared
// Atlas tier, which caps the whole cluster at 500 connections: five processes at the default
// would exhaust it on their own, and every later connection is refused cluster-wide — including
// ones belonging to requests that were already in flight. Ten is ample for this app's traffic
// (a request holds a connection only for the duration of its queries) and leaves room for
// roughly fifty concurrent instances before the cluster limit is anywhere in sight.
const MAX_POOL_SIZE = 10;

// Fail in ten seconds rather than the default thirty. When the cluster genuinely is unreachable
// — an IP missing from the Atlas access list is the usual cause — a shorter wait surfaces the
// real error instead of leaving startup apparently hung.
const SERVER_SELECTION_TIMEOUT_MS = 10_000;

// Mongoose keeps one connection pool per process, so calling connectDb() twice would otherwise
// open a second one and double this process's share of the cluster's connection budget. Holding
// the promise (not just a boolean) also means two concurrent callers await the same connection
// attempt rather than racing to start two.
let connectionPromise = null;

export async function connectDb() {
  if (connectionPromise) return connectionPromise;
  try {
    connectionPromise = mongoose.connect(config.mongoUri, {
      maxPoolSize: MAX_POOL_SIZE,
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS
    });
    await connectionPromise;
    console.log("MongoDB connected");
    return connectionPromise;
  } catch (error) {
    // Cleared so a later call can retry instead of awaiting a promise that already rejected.
    connectionPromise = null;
    console.error("MongoDB connection failed:", error.message);
    console.error("Start MongoDB or set MONGODB_URI in server/.env");
    process.exit(1);
  }
}
