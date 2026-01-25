import express from "express";
import {
  getOverviewStats,
  getPropertyGrowth,
  getMarketInsights,
} from "./dashboard.controller.js";
import { ownerDashboardSummary } from "./dashboard.controller.js";
import { checkAuth } from "../../middlewares/checkAuth.js";
import { Role } from "../auth/auth.model.js";

const router = express.Router();

router.get("/overview", getOverviewStats);
router.get("/property-growth", getPropertyGrowth);
router.get("/market-insights", getMarketInsights);
router.get("/owner-summary", checkAuth(Role.OWNER), ownerDashboardSummary);

export const dashboardRoutes =  router;
