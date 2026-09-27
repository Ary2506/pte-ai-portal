import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pte_ai_portal";
await mongoose.connect(MONGO_URI);

const userSchema = new mongoose.Schema({}, { strict: false, collection: "users" });
const sessionSchema = new mongoose.Schema({}, { strict: false, collection: "sessions" });
const User = mongoose.models.User || mongoose.model("User", userSchema);
const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);

await User.deleteMany({ username: { $in: ["__customdays_admin__", "__customdays_student__"] } });
const passwordHash = await bcrypt.hash("Test1234!", 10);

const admin = await User.create({
  username: "__customdays_admin__",
  passwordHash, name: "CD Admin", email: "__customdays_admin__@example.com",
  role: "admin", accountStatus: "ACTIVE", paymentStatus: "PAID",
});
const student = await User.create({
  username: "__customdays_student__",
  passwordHash, name: "CD Student", email: "__customdays_student__@example.com",
  role: "student", accountStatus: "ACTIVE", paymentStatus: "PAID",
  subscriptionStartDate: new Date(),
  subscriptionEndDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
  targetScore: 79,
});

async function mintToken(user) {
  const session = await Session.create({
    user: user._id, deviceId: `${user.username}-device`, userAgent: "cd-check-script",
    ipAddress: "127.0.0.1", expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return jwt.sign({ userId: user._id.toString(), sessionId: session._id.toString() }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

const adminToken = await mintToken(admin);
console.log(JSON.stringify({ adminToken, adminId: admin._id.toString(), studentUsername: student.username }));
await mongoose.disconnect();
