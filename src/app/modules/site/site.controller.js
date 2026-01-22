import httpStatus from 'http-status-codes';
import { catchAsync } from '../../utils/catchAsync.js';
import { siteServices } from './site.services.js';

const updateSite = catchAsync(async (req, res) => {
  const updateData = {
    ...req.body,
  };

  console.log("data: ", updateData)
  console.log("body", req.body)
  const site = await siteServices.updateSite(
    updateData, 
  );

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Site Information is Updated!',
    data: site
  });
});



const getMySite = catchAsync(async (req, res) => {
 
  
  const result = await siteServices.getMySite()

  res.status(httpStatus.OK).json({
    success: true,
    message: 'Your Site Information retrieved successfully',
    data: result
  });
});




export const siteControllers = {
 updateSite,
 getMySite
};