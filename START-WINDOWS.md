# Windows quick start

## 1. Install MongoDB
Run MongoDB locally, or put your MongoDB Atlas connection string in `server/.env`.

## 2. Open two terminals

Terminal 1:
```powershell
cd server
copy .env.example .env
npm install
npm run dev
```

Terminal 2:
```powershell
cd client
npm install
npm run dev
```

Open http://localhost:5173

If you want a single command from the project root:
```powershell
npm install
npm run dev
```
