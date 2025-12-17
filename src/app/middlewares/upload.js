import multer from 'multer';
import httpStatus from 'http-status-codes';
import AppError from '../errorHelpers/AppError.js';

// Configure memory storage
const storage = multer.memoryStorage();

/**
 * File filter for images
 */
const imageFileFilter = (req, file, cb) => {
  // Check file type
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(
      httpStatus.BAD_REQUEST,
      `Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`
    ), false);
  }
};

/**
 * File filter for documents
 */
const documentFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(
      httpStatus.BAD_REQUEST,
      'Invalid file type. Only PDF and Word documents are allowed'
    ), false);
  }
};

/**
 * File size limits
 */
const limits = {
  fileSize: 5 * 1024 * 1024, // 5MB
  files: 10 // Max 10 files
};

/**
 * Multer instance for image uploads
 */
const uploadImages = multer({
  storage,
  fileFilter: imageFileFilter,
  limits
});

/**
 * Multer instance for document uploads
 */
const uploadDocuments = multer({
  storage,
  fileFilter: documentFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB for documents
    files: 5
  }
});

/**
 * Multer instance for single file uploads
 */
const uploadSingleImage = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
}).single('image');

/**
 * Validate uploaded files
 */
const validateUpload = (files, maxCount = 10) => {
  if (!files || files.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, 'No files uploaded');
  }

  if (files.length > maxCount) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Maximum ${maxCount} files allowed`
    );
  }

  // Check each file size
  files.forEach(file => {
    if (file.size > limits.fileSize) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `File ${file.originalname} exceeds 5MB limit`
      );
    }
  });

  return true;
};

/**
 * Process uploaded files and extract useful info
 */
const processUploadedFiles = (files) => {
  if (!files) return [];

  const fileArray = Array.isArray(files) ? files : [files];
  
  return fileArray.map(file => ({
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    buffer: file.buffer,
    encoding: file.encoding,
    fieldname: file.fieldname,
    // Extract extension
    extension: file.originalname.split('.').pop().toLowerCase(),
    // Generate unique filename
    filename: `${Date.now()}-${Math.round(Math.random() * 1E9)}.${file.originalname.split('.').pop().toLowerCase()}`
  }));
};

/**
 * Middleware to handle single image upload
 */
const handleSingleImageUpload = (req, res, next) => {
  uploadSingleImage(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError(
            httpStatus.BAD_REQUEST,
            'File size exceeds 5MB limit'
          ));
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return next(new AppError(
            httpStatus.BAD_REQUEST,
            'Unexpected field name for file upload'
          ));
        }
      }
      return next(err);
    }

    // Process the uploaded file
    if (req.file) {
      req.uploadedFiles = processUploadedFiles([req.file]);
    }

    next();
  });
};

/**
 * Middleware to handle multiple image uploads
 */
const handleMultipleImageUpload = (fieldName = 'images', maxCount = 10) => {
  return (req, res, next) => {
    const upload = uploadImages.array(fieldName, maxCount);
    
    upload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(
              httpStatus.BAD_REQUEST,
              'One or more files exceed 5MB limit'
            ));
          }
          if (err.code === 'LIMIT_FILE_COUNT') {
            return next(new AppError(
              httpStatus.BAD_REQUEST,
              `Maximum ${maxCount} files allowed`
            ));
          }
          if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return next(new AppError(
              httpStatus.BAD_REQUEST,
              'Unexpected field name for file upload'
            ));
          }
        }
        return next(err);
      }

      // Validate uploaded files
      try {
        if (req.files) {
          validateUpload(req.files, maxCount);
          req.uploadedFiles = processUploadedFiles(req.files);
        }
        next();
      } catch (error) {
        next(error);
      }
    });
  };
};

/**
 * Middleware to handle document uploads
 */
const handleDocumentUpload = (fieldName = 'document') => {
  return (req, res, next) => {
    const upload = uploadDocuments.single(fieldName);
    
    upload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(
              httpStatus.BAD_REQUEST,
              'Document size exceeds 10MB limit'
            ));
          }
        }
        return next(err);
      }

      if (req.file) {
        req.uploadedFiles = processUploadedFiles([req.file]);
      }

      next();
    });
  };
};

/**
 * Middleware to handle mixed file uploads (images and documents)
 */
const handleMixedUpload = (fields) => {
  return (req, res, next) => {
    const upload = multer({
      storage,
      fileFilter: (req, file, cb) => {
        // Check if it's an image
        if (file.mimetype.startsWith('image/')) {
          imageFileFilter(req, file, cb);
        } 
        // Check if it's a document
        else if (file.mimetype.includes('pdf') || file.mimetype.includes('document')) {
          documentFileFilter(req, file, cb);
        } else {
          cb(new AppError(
            httpStatus.BAD_REQUEST,
            'Invalid file type. Only images and documents are allowed'
          ), false);
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
        files: 10
      }
    }).fields(fields);

    upload(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new AppError(
              httpStatus.BAD_REQUEST,
              'File size exceeds 10MB limit'
            ));
          }
        }
        return next(err);
      }

      // Process uploaded files
      const uploadedFiles = {};
      if (req.files) {
        Object.keys(req.files).forEach(fieldName => {
          uploadedFiles[fieldName] = processUploadedFiles(req.files[fieldName]);
        });
        req.uploadedFiles = uploadedFiles;
      }

      next();
    });
  };
};

/**
 * Middleware to validate image dimensions
 */
const validateImageDimensions = (minWidth = 400, minHeight = 300) => {
  return async (req, res, next) => {
    try {
      if (!req.uploadedFiles || req.uploadedFiles.length === 0) {
        return next();
      }

      const sharp = await import('sharp');
      
      for (const file of req.uploadedFiles) {
        const metadata = await sharp.default(file.buffer).metadata();
        
        if (metadata.width < minWidth || metadata.height < minHeight) {
          throw new AppError(
            httpStatus.BAD_REQUEST,
            `Image dimensions too small. Minimum ${minWidth}x${minHeight} pixels required`
          );
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware to optimize images before upload
 */
const optimizeImages = (options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.uploadedFiles || req.uploadedFiles.length === 0) {
        return next();
      }

      const sharp = await import('sharp');
      const {
        width = 1200,
        height = 800,
        quality = 80,
        format = 'jpeg'
      } = options;

      const optimizationPromises = req.uploadedFiles.map(async (file) => {
        // Only optimize images
        if (!file.mimetype.startsWith('image/')) {
          return file;
        }

        const optimizedBuffer = await sharp.default(file.buffer)
          .resize(width, height, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .toFormat(format, { quality })
          .toBuffer();

        file.buffer = optimizedBuffer;
        file.size = optimizedBuffer.length;
        file.mimetype = `image/${format}`;
        file.optimized = true;

        return file;
      });

      req.uploadedFiles = await Promise.all(optimizationPromises);
      next();
    } catch (error) {
      next(new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        'Failed to optimize images'
      ));
    }
  };
};

/**
 * Cleanup middleware to remove uploaded files on error
 */
const cleanupUploads = (req, res, next) => {
  // Store original send method
  const originalSend = res.send;

  // Override send method to handle cleanup
  res.send = function(data) {
    // If there's an error response and we have uploaded files
    if (res.statusCode >= 400 && req.uploadedFiles) {
      // Here you could add logic to delete uploaded files from Cloudinary
      // if the request fails after upload
      console.log('Cleaning up uploaded files due to error response');
    }

    // Call original send method
    return originalSend.call(this, data);
  };

  next();
};

// Export middleware functions
export default {
  // Multer instances
  uploadImages,
  uploadDocuments,
  
  // File processing functions
  processUploadedFiles,
  validateUpload,
  
  // Upload handlers
  handleSingleImageUpload,
  handleMultipleImageUpload,
  handleDocumentUpload,
  handleMixedUpload,
  
  // Image processing middleware
  validateImageDimensions,
  optimizeImages,
  
  // Utility middleware
  cleanupUploads
};