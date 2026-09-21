import mongoose from "mongoose";

// Everything for the temporary Admin Subscription Extension feature lives in this one file, on
// purpose — see server/src/routes/adminSubscriptionExtension.js for the routes that use it. To
// fully remove this experimental feature later: delete this file, delete that route file, remove
// its one import + one app.use line in server/src/app.js, and drop the three collections these
// models define (subscriptionextensions, bulkextensionrequests, extensioncounters). Nothing
// outside those two files reads from or writes to these models.

// One row per user actually extended — both for an individual extension and for each user swept
// up in a bulk extension (all sharing that bulk action's `extensionId`). This is the audit trail
// Step 5 asks for; it is intentionally its own collection rather than reusing AuditLog, since
// duplicate-protection and "history for this user" queries need structured previousExpiry/
// newExpiry/daysAdded fields, not free-form metadata.
const subscriptionExtensionSchema = new mongoose.Schema({
  extensionId: { type: String, required: true, index: true },
  type: { type: String, enum: ["INDIVIDUAL", "BULK"], required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  previousExpiry: { type: Date, required: true },
  daysAdded: { type: Number, required: true },
  newExpiry: { type: Date, required: true },
  reason: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

subscriptionExtensionSchema.index({ user: 1, createdAt: -1 });

export const SubscriptionExtension = mongoose.model("SubscriptionExtension", subscriptionExtensionSchema);

// One row per bulk "Extend All Active Subscriptions" confirmation click. `clientRequestId` is
// generated once by the frontend when the confirm dialog opens and reused if the request is
// retried (double-click, a flaky network resending the same POST). The unique index on it is what
// makes duplicate protection (Step 6) actually safe under a race, not just a client-side disabled
// button: the route creates this document FIRST, and only the request that wins the unique-index
// race goes on to touch any User documents. A retry with the same id finds the already-created
// row and returns its already-computed result instead of extending anyone a second time.
const bulkExtensionRequestSchema = new mongoose.Schema({
  clientRequestId: { type: String, required: true, unique: true },
  extensionId: { type: String, default: null },
  days: { type: Number, required: true },
  reason: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  affectedUsers: { type: Number, default: 0 }
}, { timestamps: true });

export const BulkExtensionRequest = mongoose.model("BulkExtensionRequest", bulkExtensionRequestSchema);

// Tiny atomic counter backing the human-readable EXT-<year>-<seq> id shown in the admin UI and
// stored on every history row. `$inc` + upsert in a single findOneAndUpdate is atomic in MongoDB
// regardless of replica-set/transaction support, so two concurrent extensions can never collide
// on the same id even without this project's standalone MongoDB supporting multi-document
// transactions (checked: it doesn't — see the route file's comment on the bulk update itself).
const extensionCounterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });
const ExtensionCounter = mongoose.model("ExtensionCounter", extensionCounterSchema);

export async function nextExtensionId() {
  const year = new Date().getFullYear();
  const key = `ext-${year}`;
  const doc = await ExtensionCounter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `EXT-${year}-${String(doc.seq).padStart(3, "0")}`;
}
