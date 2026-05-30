import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openrouterRouter from "./openrouter";
import githubRouter from "./github";
import authRouter from "./auth";
import apiKeysRouter from "./apikeys";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openrouterRouter);
router.use(githubRouter);
router.use(authRouter);
router.use(apiKeysRouter);
router.use(adminRouter);

export default router;
