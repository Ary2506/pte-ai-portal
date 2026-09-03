# PTE AI Portal — Complete Full-Stack Starter

A production-oriented PTE preparation portal inspired by the feature set of modern PTE practice platforms, with original UI/code.

## Included

- React + Vite frontend
- Node.js + Express backend
- MongoDB/Mongoose support
- JWT authentication + bcrypt password hashing
- Sign up / sign in / sign out
- Protected dashboard
- Profile
- Practice history
- Reading practice + timer + scoring
- Listening practice + audio player + scoring
- Writing: Summarize Written Text + Essay + feedback
- Speaking: microphone recording, timer, speech recognition where supported, audio upload, AI-style feedback
- Mock test flow
- Personalized study plan
- Admin panel + question management
- Subscription-ready API structure
- Razorpay-ready payment service placeholder
- AI provider integration point with safe fallback scoring
- Error handling and validation
- Responsive UI

## Requirements

- Node.js 18+ (Node 20 LTS recommended)
- MongoDB local OR MongoDB Atlas
- Modern Chrome/Edge recommended for microphone and speech recognition

## Start backend

```bash
cd server
copy .env.example .env
npm install
npm run dev
```

## Start frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:5000

## Environment

Backend `.env`:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/pte_ai_portal
JWT_SECRET=change_this_to_a_long_random_secret
CLIENT_URL=http://localhost:5173

# Optional. If omitted, the portal uses deterministic local scoring.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

# Optional Razorpay configuration
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

## Demo admin

After registering a normal user, call:

```text
POST /api/auth/bootstrap-admin
```

with the user's JWT in Authorization header. This is intentionally a local-development convenience. Remove/disable it before production.

## Important

The portal's AI score is an **estimated practice score**, not an official Pearson PTE score. For production, use a validated scoring methodology and approved data/content.

Microphone access requires HTTPS in production (localhost works in development).

## Suggested next production work

- Move uploaded audio to S3/Cloudinary
- Add rate limiting and refresh-token rotation
- Add email verification / password reset
- Add real Razorpay orders + webhook verification
- Add real AI provider and speech analysis pipeline
- Add automated tests and CI/CD
- Add Pearson-licensed/authorized content where required
