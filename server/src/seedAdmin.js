import bcrypt from "bcryptjs";
import User from "./models/User.js";

export async function seedAdmin() {
  const existingAdmin = await User.findOne({ role: "admin" });
  if (existingAdmin) return;

  const username = process.env.ADMIN_USERNAME?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.warn(
      "No admin account exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD in server/.env and restart the server to create the first admin."
    );
    return;
  }
  if (password.length < 8) {
    console.warn("ADMIN_PASSWORD must be at least 8 characters. Admin account was not created.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await User.create({
    username,
    name: "Administrator",
    role: "admin",
    passwordHash,
    accountStatus: "ACTIVE",
    paymentStatus: "PAID"
  });
  console.log(`Admin account "${username}" created from environment variables.`);
}
