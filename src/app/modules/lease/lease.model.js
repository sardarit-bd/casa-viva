import mongoose from "mongoose";

const leaseSchema = new mongoose.Schema(
  {
    // ================= BASIC INFORMATION =================
    title: {
      type: String,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    // ================= PARTIES =================
    landlord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ================= PROPERTY =================
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },

    // ================= LEASE TERMS =================
    startDate: Date,
    endDate: Date,

    rentAmount: {
      type: Number,
      min: 0,
    },

    rentFrequency: {
      type: String,
      enum: ["monthly", "weekly", "biweekly", "quarterly", "yearly"],
      default: "monthly",
    },

    securityDeposit: {
      type: Number,
      default: 0,
      min: 0,
    },

    utilities: {
      includedInRent: {
        type: [String],
        default: [],
      },
      paidByTenant: {
        type: [String],
        default: [],
      },
    },

    maintenanceTerms: {
      type: String,
      trim: true,
    },

    lateFee: {
      type: Number,
      min: 0,
    },

    gracePeriod: {
      type: Number,
      min: 0,
    },
    // ================= STATUS =================
    status: {
      type: String,
      enum: [
        "pending_request",
        "draft",
        "sent_to_tenant",
        "changes_requested",
        "signed_by_landlord",
        "signed_by_tenant",
        "fully_executed",
        "cancelled",
        "expired",
      ],
      default: "pending_request",
    },

    statusHistory: [
      {
        status: String,
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        reason: String,
        changedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // ================= E-SIGNATURE =================
    signatures: {
      landlord: {
        signedAt: Date,

        signatureType: {
          type: String,
          enum: ["draw", "type", "upload"],
        },

        signatureData: {
          dataUrl: String,
          typedText: String,
        },

        ipAddress: String,
        userAgent: String,
      },

      tenant: {
        signedAt: Date,

        signatureType: {
          type: String,
          enum: ["draw", "type", "upload"],
        },

        signatureData: {
          dataUrl: String,
          typedText: String,
        },

        ipAddress: String,
        userAgent: String,
      },
    },

    // ================= DOCUMENT =================
    finalDocument: {
      type: String, // PDF URL
    },

    // ================= TERMS =================
    terms: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ================= MESSAGES =================
    messages: [
      {
        from: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        message: String,
        attachments: [
          {
            url: String,
            name: String,
            type: String,
          },
        ],
        sentAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // ================= CHANGE REQUESTS =================
    requestedChanges: [
      {
        requestedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        changes: String,
        requestedAt: {
          type: Date,
          default: Date.now,
        },
        resolved: {
          type: Boolean,
          default: false,
        },
        resolvedAt: Date,
      },
    ],

    // ================= AUDIT =================
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    isLocked: {
      type: Boolean,
      default: false,
    },

    lockedAt: Date,

    expiresAt: Date,

    deletedAt: Date,

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ================= INDEXES =================
leaseSchema.index({ landlord: 1, status: 1 });
leaseSchema.index({ tenant: 1, status: 1 });
leaseSchema.index({ property: 1 });
leaseSchema.index({ status: 1, endDate: 1 });
leaseSchema.index({ createdAt: -1 });
leaseSchema.index({ isLocked: 1 });

// ================= VIRTUALS =================
leaseSchema.virtual("duration").get(function () {
  if (!this.startDate || !this.endDate) return 0;
  const diffTime = Math.abs(this.endDate - this.startDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

leaseSchema.virtual("isActive").get(function () {
  return (
    this.status === "fully_executed" &&
    new Date() >= this.startDate &&
    new Date() <= this.endDate
  );
});

leaseSchema.virtual("isExpired").get(function () {
  return this.status === "expired";
});

leaseSchema.virtual("isSignedByLandlord").get(function () {
  return !!this.signatures.landlord?.signedAt;
});

leaseSchema.virtual("isSignedByTenant").get(function () {
  return !!this.signatures.tenant?.signedAt;
});

leaseSchema.virtual("isFullySigned").get(function () {
  return (
    !!this.signatures.landlord?.signedAt && !!this.signatures.tenant?.signedAt
  );
});

leaseSchema.virtual("nextAction").get(function () {
  switch (this.status) {
    case "draft":
      return { by: "landlord", action: "send_to_tenant" };
    case "sent_to_tenant":
      return { by: "tenant", action: "review" };
    case "changes_requested":
      return { by: "landlord", action: "update_lease" };
    case "signed_by_landlord":
      return { by: "tenant", action: "sign" };
    default:
      return null;
  }
});

// ================= MIDDLEWARE =================
leaseSchema.pre("save", function () {
  if (this.isModified("status")) {
    this.statusHistory.push({
      status: this.status,
      changedBy: this._updatedBy || this.createdBy,
      changedAt: new Date(),
    });
  }

  if (this.status === "fully_executed" && !this.isLocked) {
    this.isLocked = true;
    this.lockedAt = new Date();
  }

  if (this.status === "fully_executed" && new Date() > this.endDate) {
    this.status = "expired";
  }

  if (!this.expiresAt && this.status !== "fully_executed") {
    const exp = new Date();
    exp.setDate(exp.getDate() + 30);
    this.expiresAt = exp;
  }
});

const Lease = mongoose.models.Lease || mongoose.model("Lease", leaseSchema);

export default Lease;
