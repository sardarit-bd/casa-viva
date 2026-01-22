import mongoose from 'mongoose';

const siteSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      maxlength: 100
    },
   
    featuredVideo: {
      type: String,
      default: null
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);


const Site = mongoose.model('Site', siteSchema);

export default Site;