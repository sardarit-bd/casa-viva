import mongoose from "mongoose";
import AppError from "../../errorHelpers/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { User } from "../auth/auth.model.js";
import Property from "../properties/properties.model.js";
import Lease from "./lease.model.js";
import httpStatus from "http-status-codes";
import { uploadServices } from "../upload/upload.services.js";
import { base64ToBuffer } from "../../utils/base64ToBuffer.js";

// Create new lease
const createLease = catchAsync(async (req, res) => {
  const tenantId = req.user.userId;
  const { property: propertyId } = req.body;

  // Find property
  const property = await Property.findOne({
    _id: propertyId,
    isDeleted: false,
  });

  if (!property) {
    throw new AppError(404, "Property not found");
  }

  if (property.status !== "active") {
    throw new AppError(400, "Property is not available");
  }

  const landlordId = property.owner;

  // Verify tenant
  const tenant = await User.findById(tenantId);
  if (!tenant || tenant.role !== "tenant") {
    throw new AppError(404, "Tenant not found");
  }

  // Prevent duplicate request
  const existing = await Lease.findOne({
    property: propertyId,
    tenant: tenantId,
    status: { $nin: ["cancelled", "expired"] },
    isDeleted: false,
  });

  if (existing) {
    throw new AppError(400, "You already requested this property");
  }

  const rentAmount = property.price || 0;

  const lease = await Lease.create({
    landlord: landlordId,
    tenant: tenantId,
    property: propertyId,
    status: "pending_request",
    rentAmount: rentAmount,
    rentFrequency: "monthly",
    createdBy: tenantId,
    statusHistory: [
      {
        status: "pending_request",
        changedBy: tenantId,
        reason: "Tenant requested to rent",
      },
    ],
  });

  res.status(201).json({
    success: true,
    message: "Request sent to landlord",
    data: lease,
  });
});

// Send lease to tenant
const sendToTenant = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { message } = req.body;
  const landlordId = req.user.userId;

  // Find lease (only landlord + draft)
  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: landlordId,
    status: "draft",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Lease not found or you are not authorized to send it",
    );
  }

  // Validate required fields before sending
  if (!lease.startDate || !lease.endDate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Lease start and end dates must be set before sending",
    );
  }

  if (!lease.rentAmount || lease.rentAmount <= 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Valid rent amount must be set before sending",
    );
  }

  // Update lease status
  lease.status = "sent_to_tenant";
  lease._updatedBy = landlordId;

  // Add optional message
  if (message?.trim()) {
    lease.messages.push({
      from: landlordId,
      message: message.trim(),
      sentAt: new Date(),
    });
  }

  // Save lease
  await lease.save();

  const tenant = await User.findById(lease.tenant);
  if (tenant) {
    // TODO: send email / notification
    // notifyTenant(tenant.email, lease._id);
  }

  res.status(httpStatus.OK).json({
    success: true,
    message: "Lease sent to tenant successfully",
    data: lease,
  });
});

// Request changes to lease
const requestChanges = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { changes } = req.body;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: req.user.userId }, { tenant: req.user.userId }],
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
  }

  // Check if user can request changes
  if (
    lease.status !== "sent_to_tenant" ||
    req.user.userId.toString() !== lease.tenant.toString()
  ) {
    throw new AppError(400, "Only tenant can request changes");
  }

  // Update status
  lease.status = "changes_requested";

  // Add change request
  lease.requestedChanges.push({
    requestedBy: req.user.userId,
    changes,
    requestedAt: new Date(),
  });

  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `Requested changes: ${changes}`,
    sentAt: new Date(),
  });

  await lease.save();

  // Notify other party
  const otherPartyId =
    req.user.userId.toString() === lease.landlord.toString()
      ? lease.tenant
      : lease.landlord;

  const otherUser = await User.findById(otherPartyId);
  if (otherUser) {
  }

  res.status(200).json({
    success: true,
    message: "Changes requested successfully",
    data: lease,
  });
});

// Update lease
const updateLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const updates = req.body;
  const userId = req.user.userId;

  // Find lease (both landlord and tenant can update)
  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: userId }, { tenant: userId }],
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Lease not found or unauthorized to edit",
    );
  }

  const isLandlord = lease.landlord.toString() === userId;
  const isTenant = lease.tenant.toString() === userId;

  if (updates.status) {
    if (isTenant && updates.status === "sent_to_landlord" && lease.status === "sent_to_tenant") {
      lease.status = "sent_to_landlord";

      // Add status history
      lease.statusHistory.push({
        status: "sent_to_landlord",
        changedBy: userId,
        reason: updates.message || "Tenant sent lease to landlord for signature",
      });
    }

    else if (isLandlord &&
      (updates.status === "draft" && lease.status === "changes_requested") ||
      (updates.status === "sent_to_tenant" && lease.status === "draft")
    ) {
      lease.status = updates.status;

      lease.statusHistory.push({
        status: updates.status,
        changedBy: userId,
        reason: updates.message || "Status updated by landlord",
      });
    }
    else {
      throw new AppError(400, "Cannot update status in current state");
    }
  }
  if (isLandlord) {
    const allowedUpdates = [
      "title",
      "description",
      "startDate",
      "endDate",
      "rentAmount",
      "rentFrequency",
      "securityDeposit",
      "customClauses",
    ];

    // Update allowed fields
    allowedUpdates.forEach((field) => {
      if (updates[field] !== undefined) {
        lease[field] = updates[field];
      }
    });

    // ===== FIX: Handle utilities object properly =====
    if (updates.utilities) {
      // Initialize utilities object if it doesn't exist
      if (!lease.utilities) {
        lease.utilities = {};
      }

      // Update includedInRent
      if (updates.utilities.includedInRent !== undefined) {
        lease.utilities.includedInRent = updates.utilities.includedInRent;
      }

      // Update paidByTenant
      if (updates.utilities.paidByTenant !== undefined) {
        lease.utilities.paidByTenant = updates.utilities.paidByTenant;
      }

      // Mark utilities as modified for Mongoose
      lease.markModified('utilities');
    }

    // ===== Handle Maintenance Terms =====
    if (updates.maintenanceTerms !== undefined) {
      lease.maintenanceTerms = updates.maintenanceTerms;
    }

    // ===== MERGE Terms =====
    if (updates.terms) {
      lease.terms = {
        ...(lease.terms?.toObject?.() || lease.terms || {}),
        ...updates.terms,
      };
      lease.markModified('terms');
    }

    // Handle change request resolution
    if (lease.status === "changes_requested" && updates.status === "draft") {
      lease.requestedChanges.forEach((rc) => {
        if (!rc.resolved) {
          rc.resolved = true;
          rc.resolvedAt = new Date();
          rc.resolutionNotes = updates.resolutionNotes || "Resolved by landlord";
        }
      });
    }
  }

  // ===== ADD MESSAGE (both can add messages) =====
  if (updates.message?.trim()) {
    lease.messages.push({
      from: userId,
      message: updates.message.trim(),
      sentAt: new Date(),
    });
  }

  lease._updatedBy = userId;
  await lease.save();

  console.log("Lease updated successfully:", {
    leaseId: lease._id,
    status: lease.status,
    updatedBy: isLandlord ? "landlord" : "tenant",
  });

  res.status(httpStatus.OK).json({
    success: true,
    message: "Lease updated successfully",
    data: lease,
  });
});


// Sign lease with simple signature
const signLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { signatureDataUrl, signatureMode, typedSignature } = req.body;
  const userId = req.user.userId;

  if (!signatureDataUrl || !signatureMode) {
    throw new AppError(400, "Signature data is required");
  }

  const lease = await Lease.findOne({ _id: leaseId, isDeleted: false });

  if (!lease) {
    throw new AppError(404, "Lease not found");
  }

  if (lease.isLocked) {
    throw new AppError(400, "Lease already finalized");
  }

  const isLandlord = lease.landlord.toString() === userId;
  const isTenant = lease.tenant.toString() === userId;

  if (!isLandlord && !isTenant) {
    throw new AppError(403, "Unauthorized");
  }

  const role = isLandlord ? "landlord" : "tenant";

  // ================= SIGNING ORDER (IMPORTANT) =================
  // Tenant CANNOT sign before landlord
  if (role === "tenant" && !lease.signatures?.landlord?.signedAt) {
    throw new AppError(400, "Landlord must sign first");
  }

  if (lease.signatures?.[role]?.signedAt) {
    throw new AppError(400, "Already signed");
  }

  // ================= BASE64 → BUFFER =================
  const signatureBuffer = base64ToBuffer(signatureDataUrl);

  // ================= CLOUDINARY UPLOAD =================
  const uploadResult = await uploadServices.uploadSingleFile(
    signatureBuffer,
    `leases/${leaseId}/signatures`,
    "image"
  );

  // ================= SAVE SIGNATURE =================
  lease.signatures[role] = {
    signedAt: new Date(),
    signatureType: signatureMode,
    signatureData: {
      dataUrl: uploadResult.url,
      typedText: signatureMode === "type" ? typedSignature : undefined,
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  };

  // ================= STATUS UPDATE =================
  if (role === "landlord") {
    lease.status = "signed_by_landlord";
  } else {
    lease.status = "fully_executed";
    lease.isLocked = true;
    lease.lockedAt = new Date();
  }

  lease.messages.push({
    from: userId,
    message: `${role} signed the lease`,
    sentAt: new Date(),
  });

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease signed successfully",
    data: {
      status: lease.status,
      isFullySigned: lease.isFullySigned,
      signatureUrl: uploadResult.url,
    },
  });
});


// Get leases for current user
const getMyLeases = catchAsync(async (req, res) => {
  const { status, role } = req.query;
  const userId = req.user.userId;

  let query = {
    $or: [{ landlord: userId }, { tenant: userId }],
    isDeleted: false,
  };

  // Filter by role if specified
  if (role === "landlord") {
    query = { landlord: userId, isDeleted: false };
  } else if (role === "tenant") {
    query = { tenant: userId, isDeleted: false };
  }

  // Filter by status if specified
  if (status && status !== "all") {
    query.status = status;
  }

  const leases = await Lease.find(query)
    .populate("property", "title address city type price")
    .populate("landlord", "name email")
    .populate("tenant", "name email")
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    message: "Leases retrieved successfully",
    data: leases,
    count: leases.length,
  });
});

// Get lease by ID
const getLeaseById = catchAsync(async (req, res) => {
  const { leaseId } = req.params;

  // Validate leaseId format
  if (!mongoose.Types.ObjectId.isValid(leaseId)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid lease ID format");
  }

  try {
    const lease = await Lease.findOne({
      _id: leaseId,
      $or: [{ landlord: req.user.userId }, { tenant: req.user.userId }],
      isDeleted: false,
    })
      .populate(
        "property",
        "title address city state zipCode type amenities price",
      )
      .populate("landlord", "name email phone profilePicture")
      .populate("tenant", "name email phone profilePicture")
      .populate("createdBy", "name email")
      .populate("statusHistory.changedBy", "name email")
      .populate("messages.from", "name email profilePicture")
      .populate("requestedChanges.requestedBy", "name email");

    if (!lease) {
      console.log("Lease not found or unauthorized access attempt");
      throw new AppError(
        httpStatus.NOT_FOUND,
        "Lease not found or you are not authorized to view this lease",
      );
    }

    res.status(200).json({
      success: true,
      message: "Lease retrieved successfully",
      data: lease,
    });
  } catch (error) {
    console.error("Error in getLeaseById:", error);
    throw error;
  }
});

// Cancel lease
const cancelLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { reason } = req.body;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: req.user.userId }, { tenant: req.user.userId }],
    status: { $nin: ["fully_executed", "cancelled", "expired"] },
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Lease not found or cannot be cancelled",
    );
  }

  // Update status
  lease.status = "cancelled";

  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `Lease cancelled. Reason: ${reason || "No reason provided"}`,
    sentAt: new Date(),
  });

  await lease.save();

  const otherPartyId =
    req.user.userId.toString() === lease.landlord.toString()
      ? lease.tenant
      : lease.landlord;

  const otherUser = await User.findById(otherPartyId);
  if (otherUser) {
  }

  res.status(200).json({
    success: true,
    message: "Lease cancelled successfully",
    data: lease,
  });
});

// Get lease statistics
const getLeaseStats = catchAsync(async (req, res) => {
  const userId = req.user.userId;

  const objectUserId = new mongoose.Types.ObjectId(userId);

  const stats = await Lease.aggregate([
    {
      $match: {
        $or: [{ landlord: objectUserId }, { tenant: objectUserId }],
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalRent: { $sum: "$rentAmount" },
      },
    },
    {
      $project: {
        status: "$_id",
        count: 1,
        totalRent: 1,
        _id: 0,
      },
    },
  ]);

  const asLandlord = await Lease.countDocuments({
    landlord: userId,
    isDeleted: false,
  });

  const asTenant = await Lease.countDocuments({
    tenant: userId,
    isDeleted: false,
  });

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const expiringSoon = await Lease.countDocuments({
    $or: [{ landlord: userId }, { tenant: userId }],
    status: "fully_executed",
    endDate: {
      $gte: new Date(),
      $lte: thirtyDaysFromNow,
    },
    isDeleted: false,
  });

  res.status(200).json({
    success: true,
    message: "Statistics retrieved successfully",
    data: {
      byStatus: stats,
      counts: {
        total: asLandlord + asTenant,
        asLandlord,
        asTenant,
      },
      expiringSoon,
    },
  });
});

// Soft delete lease (archive)
const deleteLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: req.user.userId }, { tenant: req.user.userId }],
    status: { $in: ["draft", "cancelled", "expired"] },
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Lease not found or cannot be deleted",
    );
  }

  lease.isDeleted = true;
  lease.deletedAt = new Date();

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease deleted successfully",
    data: { leaseId, deletedAt: new Date() },
  });
});

// Restore deleted lease
const restoreLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;

  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [{ landlord: req.user.userId }, { tenant: req.user.userId }],
    isDeleted: true,
  });

  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, "Deleted lease not found");
  }

  lease.isDeleted = false;
  lease.deletedAt = undefined;

  await lease.save();

  res.status(200).json({
    success: true,
    message: "Lease restored successfully",
    data: lease,
  });
});

const approveRequest = catchAsync(async (req, res) => {
  const lease = await Lease.findOne({
    _id: req.params.leaseId,
    landlord: req.user.userId,
    status: "pending_request",
    isDeleted: false,
  }).populate("property");

  if (!lease) {
    throw new AppError(404, "Request not found");
  }

  lease.status = "draft";
  lease._updatedBy = req.user.userId;

  if (!lease.rentAmount && lease.property?.price) {
    lease.rentAmount = lease.property.price;
  }

  // Initialize utilities if needed
  if (!lease.utilities) {
    lease.utilities = {
      includedInRent: [],
      paidByTenant: []
    };
  }

  lease.statusHistory.push({
    status: "draft",
    changedBy: req.user.userId,
    reason: "Owner approved request",
  });

  await lease.save();

  res.json({
    success: true,
    message: "Request approved. Lease draft created",
    data: lease,
  });
});


const sendToLandlordForSignature = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { message } = req.body;
  const tenantId = req.user.userId;

  // Find lease
  const lease = await Lease.findOne({
    _id: leaseId,
    tenant: tenantId,
    status: "sent_to_tenant",
    isDeleted: false,
  });

  if (!lease) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Lease not found or you are not authorized"
    );
  }
  if (lease.signatures?.tenant?.signedAt) {
    throw new AppError(400, "You have already signed this lease");
  }

  // Update status
  lease.status = "sent_to_landlord";
  lease._updatedBy = tenantId;

  // Add message if provided
  if (message?.trim()) {
    lease.messages.push({
      from: tenantId,
      message: message.trim(),
      sentAt: new Date(),
    });
  }

  // Add status history
  lease.statusHistory.push({
    status: "sent_to_landlord",
    changedBy: tenantId,
    reason: "Tenant sent lease to landlord for signature",
  });

  await lease.save();

  // Notify landlord (TODO: send email/notification)
  const landlord = await User.findById(lease.landlord);
  if (landlord) {
    // notifyLandlord(landlord.email, lease._id);
  }

  res.status(200).json({
    success: true,
    message: "Lease sent to landlord for signature successfully",
    data: lease,
  });
});

export {
  createLease,
  sendToTenant,
  requestChanges,
  updateLease,
  signLease,
  getMyLeases,
  getLeaseById,
  cancelLease,
  getLeaseStats,
  deleteLease,
  restoreLease,
  approveRequest,
  sendToLandlordForSignature
};
