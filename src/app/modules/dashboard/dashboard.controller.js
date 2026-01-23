

/* -----------------------------------
   OVERVIEW CARDS
------------------------------------*/

import Payment from "../../payments/payment.model.js";
import { User } from "../auth/auth.model.js";
import Property from "../properties/properties.model.js";

export const getOverviewStats = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [
      totalUsers,
      totalProperties,
      totalRevenueAgg,
      newListings,
      lastMonthUsers,
    ] = await Promise.all([
      User.countDocuments(),
      Property.countDocuments(),
      Payment.aggregate([
        { $match: { status: "paid" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Property.countDocuments({ createdAt: { $gte: startOfMonth } }),
      User.countDocuments({ createdAt: { $gte: lastMonth, $lt: startOfMonth } }),
    ]);

    const totalRevenue = totalRevenueAgg[0]?.total || 0;

    res.json({
      totalUsers,
      totalProperties,
      featuredRevenue: totalRevenue,
      newListings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Dashboard error" });
  }
};



/* -----------------------------------
   PROPERTY GROWTH GRAPH
------------------------------------*/

export const getPropertyGrowth = async (req, res) => {
  try {
    const MONTHS = 4;

    const now = new Date();

    // Start at beginning of earliest month
    const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1), 1);

    const raw = await Property.aggregate([
      {
        $match: {
          createdAt: { $gte: start },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);

    // -----------------------------
    // Fill missing months with 0
    // -----------------------------

    const results = [];
    const map = new Map();

    raw.forEach(r => {
      map.set(`${r._id.year}-${r._id.month}`, r.count);
    });

    for (let i = 0; i < MONTHS; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);

      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;

      results.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        count: map.get(key) || 0,
      });
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Growth fetch failed" });
  }
};



/* -----------------------------------
   MARKET INSIGHTS PANEL
------------------------------------*/

export const getMarketInsights = async (req, res) => {
  try {
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      topCity,
      popularType,
      activeOwners,
      pendingApprovals,
      newToday,
      monthRevenue,
      sold,
      rented,
      avgPrice,
      featured,
      cities,
    ] = await Promise.all([
      Property.aggregate([
        { $group: { _id: "$city", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 1 },
      ]),

      Property.aggregate([
        { $group: { _id: "$type", total: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 1 },
      ]),

      User.countDocuments({ role: "owner" }),

      Property.countDocuments({ status: "pending" }),

      User.countDocuments({
        createdAt: { $gte: new Date().setHours(0, 0, 0, 0) },
      }),

      Payment.aggregate([
        {
          $match: {
            status: "paid",
            createdAt: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),

      Property.countDocuments({ status: "sold" }),

      Property.countDocuments({ status: "rented" }),

      Property.aggregate([
        { $group: { _id: null, avg: { $avg: "$price" } } },
      ]),

      Property.countDocuments({ featured: true }),

      Property.distinct("city"),
    ]);

    res.json({
      topCity: topCity[0]?._id || null,
      mostPopularType: popularType[0]?._id || null,
      activeOwners,
      pendingApprovals,
      newRegistrationsToday: newToday,
      monthRevenue: monthRevenue[0]?.total || 0,
      sold,
      rented,
      averagePrice: avgPrice[0]?.avg || 0,
      totalFeatured: featured,
      totalCities: cities.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Insights fetch failed" });
  }
};

export const ownerDashboardSummary = async (req, res) => {
  try {
    const ownerId = req.user.userId; // from auth middleware
    console.log(req.user)

    /* -----------------------------
       KPI STATS
    ------------------------------*/

    const [
      totalProperties,
      activeListings,
      featuredProperties,
    ] = await Promise.all([
      Property.countDocuments({ owner: ownerId }),
      Property.countDocuments({ owner: ownerId, status: "active" }),
      Property.countDocuments({ owner: ownerId, isFeatured: true }),
    ]);

    // Monthly revenue
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const revenueAgg = await Payment.aggregate([
      {
        $match: {
          owner: ownerId,
          status: "completed",
          createdAt: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const monthlyRevenue = revenueAgg[0]?.total || 0;

    /* -----------------------------
       RECENT PROPERTIES
    ------------------------------*/

    const recentProperties = await Property.find({ owner: ownerId })
      .sort({ createdAt: -1 })
      .limit(4)
      .select("title price views status isFeatured");

    /* -----------------------------
       RECENT PAYMENTS
    ------------------------------*/

    const recentPayments = await Payment.find({ owner: ownerId })
      .sort({ createdAt: -1 })
      .limit(3)
      .select("amount status createdAt property")
      .populate("property", "title");

    /* -----------------------------
       RESPONSE
    ------------------------------*/

    res.json({
      stats: {
        totalProperties,
        activeListings,
        featuredProperties,
        monthlyRevenue,
      },
      recentProperties,
      recentPayments,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Dashboard fetch failed" });
  }
};