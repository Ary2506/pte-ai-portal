import mongoose from "mongoose";
import { SECTIONS } from "../sections.js";

// One row per purchase, renewal or account creation that granted section access. Append-only:
// rows are never edited, so this is the history of what a student was given and when, independent
// of User.sectionAccess, which only holds the current state. `results` records each section's end
// date before and after, which is what answers "why does Reading end on Jan 7" later on.
const sectionPurchaseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sections: [{ type: String, enum: SECTIONS }],
  days: { type: Number, required: true },
  // PURCHASE: the admin's "Add purchase". CREATE: granted with a new paid account. RENEW: the
  // existing Renew action.
  kind: { type: String, enum: ["PURCHASE", "CREATE", "RENEW"], default: "PURCHASE" },
  paymentId: { type: String, default: null },
  note: { type: String, default: null },
  results: [{
    _id: false,
    section: { type: String, enum: SECTIONS },
    previousEndDate: { type: Date, default: null },
    endDate: { type: Date }
  }],
  grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

sectionPurchaseSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("SectionPurchase", sectionPurchaseSchema);
