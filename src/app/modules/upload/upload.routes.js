import express from 'express';

import { upload } from '../../middlewares/upload.js';
import { uploadControllers } from './upload.controller.js';
import { uploadVideo } from '../../middlewares/uploadVideo.js';
import { uploadVideoController } from './uploadVideo.controller.js';

const router = express.Router();

// Single image upload
router.post(
  '/image',
  upload.single('image'),
  uploadControllers.uploadSingleImage
);

// Multiple images upload
router.post(
  '/images',
  upload.array('images', 10),
  uploadControllers.uploadMultipleImages
);

// PDF/document upload
router.post(
  '/document',
  upload.single('file'),
  uploadControllers.uploadDocument
);

router.post(
  '/video',
  uploadVideo.single('file'),
  uploadVideoController
);

// Delete file from Cloudinary
router.delete(
  '/image/:publicId',
  uploadControllers.deleteImage
);

router.delete(
  '/document/:publicId',
  uploadControllers.deleteDocument
);

export const UploadRoutes = router;