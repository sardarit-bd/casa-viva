import express from "express";
import { exportPayments, exportProperties, exportUsers } from "./exports.controller.js";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const router = express.Router();

router.get("/properties", exportProperties);
router.get("/users", exportUsers);
router.get("/payments", exportPayments);

export const exportRoutes =  router;
