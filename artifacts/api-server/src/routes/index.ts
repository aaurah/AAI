import { Router, type IRouter } from "express";
import healthRouter from "./health";
import openrouterRouter from "./openrouter";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use(openrouterRouter);
router.use(githubRouter);

export default router;
