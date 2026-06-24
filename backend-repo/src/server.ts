import "dotenv/config";
import express from "express";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { Router } from "express";
import query from "./routes/query.js";
import historyRouter from "./routes/history.js";
import githubAuthRouter from "./routes/githubAuth.js";
import { requireClerkSession } from "./middleware/requireClerk.js";
import documentRouter from "./routes/document.js";
import githubRouter from "./routes/github.js";          // ← ADD

const defaultOrigins = [
  "https://explain-github-main.vercel.app",
  "http://localhost:5173",
];
const origins =
  process.env.FRONTEND_ORIGINS?.split(",")
    .map((o) => o.trim())
    .filter(Boolean) ?? defaultOrigins;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const queryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const parseQueryBody = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }

  queryUpload.any()(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: "Invalid query request body." });
      return;
    }
    next();
  });
};

app.use(
  cors({
    origin: origins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

const PORT = process.env.PORT || 3009;

const router1 = Router();
app.use(router1);

router1.post("/query",           requireClerkSession, parseQueryBody, query);
router1.use("/history",          historyRouter);
router1.use("/auth/github",      githubAuthRouter);
router1.use("/documents",        documentRouter);
router1.use("/github",           githubRouter);          // ← ADD

app.listen(PORT, function (err: unknown) {
  if (err) console.log(err);
  console.log("Server listening on PORT", PORT);
});
