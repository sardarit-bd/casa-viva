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

    // ================= APPLICATION SCREENING =================
    application: {
      status: {
        type: String,
        enum: ["pending", "under_review", "approved", "rejected"],
        default: "pending",
      },
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      screeningResults: {
        creditScore: Number,
        incomeVerified: Boolean,
        employmentVerified: Boolean,
        referencesChecked: Boolean,
        criminalBackground: Boolean,
        overallScore: Number,
      },
      documents: [
        {
          type: { type: String }, // id_proof, income_proof, reference_letter
          url: String,
          name: String,
          uploadedAt: Date,
          verified: { type: Boolean, default: false },
        },
      ],
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

    depositStatus: {
      type: String,
      enum: ["pending", "paid", "held", "returned", "partially_returned"],
      default: "pending",
    },

    depositTransactions: [
      {
        amount: Number,
        type: { type: String, enum: ["deposit", "return", "deduction"] },
        date: Date,
        description: String,
        proof: String,
      },
    ],

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

    // ================= INSPECTIONS =================
    inspections: {
      moveIn: {
        scheduledAt: Date,
        conductedAt: Date,
        conductedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        report: String,
        photos: [String],
        signedByLandlord: Boolean,
        signedByTenant: Boolean,
        signedAt: Date,
      },
      moveOut: {
        scheduledAt: Date,
        conductedAt: Date,
        conductedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        report: String,
        photos: [String],
        condition: {
          type: String,
          enum: ["excellent", "good", "fair", "poor", "damaged"],
        },
        damages: [
          {
            description: String,
            estimatedCost: Number,
            photos: [String],
            responsibility: { type: String, enum: ["tenant", "landlord", "shared"] },
          },
        ],
      },
      periodic: [
        {
          date: Date,
          conductedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          findings: String,
          photos: [String],
          nextInspectionDate: Date,
        },
      ],
    },

    // ================= STATUS =================
    status: {
      type: String,
      enum: [
        "pending_request",       // Tenant applied
        "under_review",          // Landlord reviewing application
        "approved",              // Application approved
        "rejected",              // Application rejected
        "draft",                 // Lease draft created
        "sent_to_tenant",        // Sent for tenant signature
        "changes_requested",     // Tenant requested changes
        "sent_to_landlord",      // Sent to landlord for signature
        "signed_by_landlord",    // Landlord signed
        "signed_by_tenant",      // Tenant signed
        "fully_executed",        // Fully signed
        "active",                // Lease is active (move-in completed)
        "renewal_pending",       // Renewal period
        "notice_given",          // Notice period started
        "move_out_scheduled",    // Move-out scheduled
        "cancelled",             // Cancelled before execution
        "expired",               // Lease term ended
        "terminated",            // Early termination
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
        metadata: mongoose.Schema.Types.Mixed,
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

    // ================= DOCUMENTS =================
    documents: [
      {
        type: { type: String, enum: ["lease", "addendum", "notice", "inspection", "other"] },
        name: String,
        url: String,
        uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        uploadedAt: { type: Date, default: Date.now },
        version: Number,
        isActive: { type: Boolean, default: true },
      },
    ],

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
        readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
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
        resolutionNotes: String,
      },
    ],

    // ================= NOTICES =================
    notices: [
      {
        type: { type: String, enum: ["renewal", "termination", "rent_increase", "other"] },
        givenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        givenAt: Date,
        effectiveDate: Date,
        reason: String,
        document: String,
        acknowledged: Boolean,
        acknowledgedAt: Date,
      },
    ],

    // ================= PAYMENTS =================
    paymentSettings: {
      dueDate: Number, // Day of month
      gracePeriod: Number,
      lateFee: Number,
      paymentMethods: [String],
      autoPayEnabled: Boolean,
    },

    // ================= RENEWAL =================
    renewal: {
      status: {
        type: String,
        enum: ["not_due", "pending", "offered", "accepted", "declined", "expired"],
        default: "not_due",
      },
      offeredAt: Date,
      responseDueBy: Date,
      newEndDate: Date,
      newRentAmount: Number,
      termsChanged: Boolean,
      notes: String,
    },

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

    // ================= METADATA =================
    metadata: {
      moveInDate: Date,
      moveOutDate: Date,
      keysHandedOver: Boolean,
      keysReturned: Boolean,
      utilityAccountsTransferred: Boolean,
      forwardingAddress: String,
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
leaseSchema.index({ "application.status": 1 });
leaseSchema.index({ "renewal.status": 1, endDate: 1 });

// ================= VIRTUALS =================
leaseSchema.virtual("duration").get(function () {
  if (!this.startDate || !this.endDate) return 0;
  const diffTime = Math.abs(this.endDate - this.startDate);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

leaseSchema.virtual("monthsRemaining").get(function () {
  if (!this.endDate || this.status !== "active") return 0;
  const now = new Date();
  const end = new Date(this.endDate);
  if (end <= now) return 0;
  
  const months = (end.getFullYear() - now.getFullYear()) * 12;
  return months - now.getMonth() + end.getMonth();
});

leaseSchema.virtual("isActive").get(function () {
  return (
    this.status === "fully_executed" &&
    new Date() >= this.startDate &&
    new Date() <= this.endDate
  );
});

leaseSchema.virtual("isExpired").get(function () {
  return this.status === "expired" || (this.endDate && new Date() > this.endDate);
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

leaseSchema.virtual("requiresAction").get(function () {
  const user = this._user; // Set from middleware
  if (!user) return null;
  
  const isLandlord = this.landlord && user._id.toString() === this.landlord.toString();
  const isTenant = this.tenant && user._id.toString() === this.tenant.toString();
  
  switch (this.status) {
    case "pending_request":
      return isLandlord ? { action: "review_application", priority: "high" } : null;
    case "approved":
      return isLandlord ? { action: "create_lease_draft", priority: "medium" } : null;
    case "draft":
      return isLandlord ? { action: "send_to_tenant", priority: "medium" } : null;
    case "sent_to_tenant":
      return isTenant ? { action: "review_lease", priority: "high" } : null;
    case "changes_requested":
      return isLandlord ? { action: "update_lease", priority: "medium" } : null;
    case "signed_by_landlord":
      return isTenant ? { action: "sign_lease", priority: "high" } : null;
    case "renewal_pending":
      if (isTenant) return { action: "respond_to_renewal", priority: "medium" };
      if (isLandlord) return { action: "send_renewal", priority: "low" };
      return null;
    default:
      return null;
  }
});

// ================= METHODS =================
leaseSchema.methods.addStatusChange = function (newStatus, changedBy, reason, metadata = {}) {
  this.status = newStatus;
  this.statusHistory.push({
    status: newStatus,
    changedBy: changedBy,
    reason: reason,
    metadata: metadata,
    changedAt: new Date(),
  });
  this._updatedBy = changedBy;
};

leaseSchema.methods.addMessage = function (from, message, attachments = []) {
  this.messages.push({
    from: from,
    message: message,
    attachments: attachments,
    sentAt: new Date(),
    readBy: [from],
  });
};

leaseSchema.methods.requestChange = function (requestedBy, changes) {
  this.requestedChanges.push({
    requestedBy: requestedBy,
    changes: changes,
    requestedAt: new Date(),
    resolved: false,
  });
  this.addStatusChange("changes_requested", requestedBy, "Tenant requested changes");
  this.addMessage(requestedBy, `Requested changes: ${changes}`);
};

// ================= MIDDLEWARE =================
leaseSchema.pre("save", function () {
  // Auto-update status based on dates
  if (this.endDate && new Date() > this.endDate && this.status === "active") {
    this.status = "expired";
  }
  
  // Set active status after move-in
  if (this.metadata?.moveInDate && new Date() >= this.metadata.moveInDate && this.status === "fully_executed") {
    this.status = "active";
  }
  
  // Auto-create renewal notice 60 days before expiry
  if (this.endDate) {
    const sixtyDaysBefore = new Date(this.endDate);
    sixtyDaysBefore.setDate(sixtyDaysBefore.getDate() - 60);
    
    if (new Date() >= sixtyDaysBefore && 
        this.status === "active" && 
        !this.notices.some(n => n.type === "renewal")) {
      this.notices.push({
        type: "renewal",
        givenBy: this.landlord,
        givenAt: new Date(),
        effectiveDate: this.endDate,
        reason: "Lease renewal notice",
        acknowledged: false,
      });
      this.renewal.status = "pending";
    }
  }
  
});

const Lease = mongoose.models.Lease || mongoose.model("Lease", leaseSchema);

export default Lease;