import { Parser } from "json2csv";
import Property from "../properties/properties.model.js";
import { User } from "../auth/auth.model.js";
import Payment from "../../payments/payment.model.js";

const sendCSV = async (res, cursor, fields, filename) => {
  const parser = new Parser({ fields });

  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  res.setHeader("Content-Type", "text/csv");

  // Write header
  res.write(parser.parse([]));

  for await (const doc of cursor) {
    const csv = parser.parse([doc]);
    const lines = csv.split("\n").slice(1).join("\n");

    res.write("\n" + lines);
  }

  res.end();
};

// -----------------------------

export const exportProperties = async (req, res) => {
  try {
    const cursor =  Property.find().lean().cursor();

    await sendCSV(
      res,
      cursor,
      ["_id", "title", "price", "city"],
      "properties.csv"
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Export failed" });
  }
};

export const exportUsers = async (req, res) => {
  try {
    const cursor = User.find().lean().cursor();

    await sendCSV(
      res,
      cursor,
      ["_id", "name", "email", "role"],
      "users.csv"
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Export failed" });
  }
};

export const exportPayments = async (req, res) => {
  try {
    const cursor = Payment.find().lean().cursor();

    await sendCSV(
      res,
      cursor,
      ["_id", "stripeId", "amount", "status", "createdAt"],
      "payments.csv"
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Export failed" });
  }
};
