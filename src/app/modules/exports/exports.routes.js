import express from "express";
import { exportPayments, exportProperties, exportUsers } from "./exports.controller.js";


const router = express.Router();

router.get("/properties", exportProperties);
router.get("/users", exportUsers);
router.get("/payments", exportPayments);

export const exportRoutes =  router;
