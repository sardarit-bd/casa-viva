import { videoUploadService } from "./videoUpload.service.js";


export const uploadVideoController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No video file provided" });
    }

    const video = await videoUploadService.uploadSingleVideo(
      req.file.buffer,
      "properties/videos"
    );

    console.log(video)
    res.status(201).json({
      success: true,
      data: video,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
