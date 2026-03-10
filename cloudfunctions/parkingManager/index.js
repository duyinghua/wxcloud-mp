// 停车场管理云函数
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 集合名称
const PARKING_LOTS_COL = 'parking_lots';     // 车场集合
const PARKING_SPOTS_COL = 'parking_spots';   // 车位集合
const BOOKINGS_COL = 'parking_bookings';     // 预订集合

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { action } = event;

  try {
    switch (action) {
      case 'initData':
        return await initData();
      case 'getParkingLots':
        return await getParkingLots();
      case 'getParkingSpots':
        return await getParkingSpots(event.lotId);
      case 'bookSpot':
        return await bookSpot(openid, event.spotId, event.lotId, event.startTime, event.hours);
      case 'cancelBooking':
        return await cancelBooking(openid, event.bookingId);
      case 'getMyBookings':
        return await getMyBookings(openid);
      case 'getBookingDetail':
        return await getBookingDetail(openid, event.bookingId);
      default:
        return { code: -1, msg: '未知操作' };
    }
  } catch (err) {
    console.error('parkingManager error:', err);
    return { code: -1, msg: err.message || '服务器错误' };
  }
};

// 初始化示例数据（首次使用时调用）
async function initData() {
  // 检查是否已有数据
  const existing = await db.collection(PARKING_LOTS_COL).count();
  if (existing.total > 0) {
    return { code: 0, msg: '数据已存在，跳过初始化' };
  }

  const lots = [
    {
      name: '中央广场停车场',
      address: '市中心中央广场地下一层',
      totalSpots: 120,
      availableSpots: 120,
      pricePerHour: 8,
      openTime: '00:00',
      closeTime: '24:00',
      tags: ['24小时', '地下停车'],
      lat: 23.1291,
      lng: 113.2644,
      status: 'open',
      createTime: db.serverDate(),
    },
    {
      name: '万象城购物中心停车场',
      address: '天河区天河路228号',
      totalSpots: 200,
      availableSpots: 200,
      pricePerHour: 10,
      openTime: '09:00',
      closeTime: '22:00',
      tags: ['商场配套', '室内停车'],
      lat: 23.1301,
      lng: 113.3244,
      status: 'open',
      createTime: db.serverDate(),
    },
    {
      name: '科技园北区停车场',
      address: '南山区科技园北区科苑路',
      totalSpots: 80,
      availableSpots: 80,
      pricePerHour: 6,
      openTime: '07:00',
      closeTime: '21:00',
      tags: ['工作日', '露天停车'],
      lat: 22.5431,
      lng: 113.9344,
      status: 'open',
      createTime: db.serverDate(),
    },
    {
      name: '东站交通枢纽停车场',
      address: '天河区天河东路东站广场',
      totalSpots: 300,
      availableSpots: 300,
      pricePerHour: 12,
      openTime: '00:00',
      closeTime: '24:00',
      tags: ['24小时', '高铁配套', '大型停车场'],
      lat: 23.1511,
      lng: 113.3744,
      status: 'open',
      createTime: db.serverDate(),
    },
  ];

  // 插入车场数据
  const lotResults = [];
  for (const lot of lots) {
    const res = await db.collection(PARKING_LOTS_COL).add({ data: lot });
    lotResults.push(res._id);
  }

  // 为每个车场创建车位
  const spotRows = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < lotResults.length; i++) {
    const lotId = lotResults[i];
    const totalSpots = lots[i].totalSpots;
    const spotsPerRow = Math.ceil(totalSpots / spotRows.length);
    const spotBatch = [];

    for (let r = 0; r < spotRows.length; r++) {
      const count = r < spotRows.length - 1 ? spotsPerRow : totalSpots - spotsPerRow * (spotRows.length - 1);
      for (let n = 1; n <= count; n++) {
        spotBatch.push({
          lotId,
          spotNo: `${spotRows[r]}${String(n).padStart(3, '0')}`,
          row: spotRows[r],
          status: 'available', // available | occupied | reserved | disabled
          type: n % 15 === 0 ? 'disabled' : (n % 10 === 0 ? 'vip' : 'normal'),
          currentBookingId: null,
          createTime: db.serverDate(),
        });
      }
    }

    // 分批插入（云数据库单次最多100条）
    for (let j = 0; j < spotBatch.length; j += 100) {
      const chunk = spotBatch.slice(j, j + 100);
      for (const spot of chunk) {
        await db.collection(PARKING_SPOTS_COL).add({ data: spot });
      }
    }
  }

  return { code: 0, msg: '初始化成功', data: { lots: lotResults.length } };
}

// 获取所有车场列表（含实时剩余车位）
async function getParkingLots() {
  const res = await db.collection(PARKING_LOTS_COL)
    .where({ status: _.neq('closed') })
    .orderBy('createTime', 'asc')
    .get();

  // 实时统计每个车场的可用车位
  const lots = res.data;
  for (const lot of lots) {
    const countRes = await db.collection(PARKING_SPOTS_COL)
      .where({ lotId: lot._id, status: 'available' })
      .count();
    lot.availableSpots = countRes.total;

    const totalRes = await db.collection(PARKING_SPOTS_COL)
      .where({ lotId: lot._id, status: _.neq('disabled') })
      .count();
    lot.totalSpots = totalRes.total;
  }

  return { code: 0, data: lots };
}

// 获取指定车场的车位列表
async function getParkingSpots(lotId) {
  if (!lotId) return { code: -1, msg: '缺少车场ID' };

  const lotRes = await db.collection(PARKING_LOTS_COL).doc(lotId).get();
  const lot = lotRes.data;

  const spotsRes = await db.collection(PARKING_SPOTS_COL)
    .where({ lotId })
    .orderBy('spotNo', 'asc')
    .get();

  // 按行分组
  const rows = {};
  for (const spot of spotsRes.data) {
    if (!rows[spot.row]) rows[spot.row] = [];
    rows[spot.row].push(spot);
  }

  const availableCount = spotsRes.data.filter(s => s.status === 'available').length;

  return {
    code: 0,
    data: {
      lot,
      spots: spotsRes.data,
      rows,
      availableCount,
      totalCount: spotsRes.data.filter(s => s.type !== 'disabled').length,
    }
  };
}

// 预订车位
async function bookSpot(openid, spotId, lotId, startTime, hours) {
  if (!spotId || !lotId) return { code: -1, msg: '参数不完整' };

  const hoursNum = parseInt(hours) || 2;
  const startTs = startTime ? new Date(startTime) : new Date();
  const endTs = new Date(startTs.getTime() + hoursNum * 3600 * 1000);

  // 检查车位状态
  const spotRes = await db.collection(PARKING_SPOTS_COL).doc(spotId).get();
  const spot = spotRes.data;

  if (spot.status !== 'available') {
    return { code: -1, msg: '该车位当前不可预订' };
  }

  // 检查用户是否已有未完成的预订
  const existingBooking = await db.collection(BOOKINGS_COL)
    .where({
      openid,
      status: _.in(['pending', 'active']),
    })
    .count();

  if (existingBooking.total > 0) {
    return { code: -1, msg: '您已有进行中的预订，请先取消或完成当前预订' };
  }

  // 创建预订记录
  const bookingData = {
    openid,
    spotId,
    lotId,
    spotNo: spot.spotNo,
    startTime: startTs,
    endTime: endTs,
    hours: hoursNum,
    totalFee: 0, // 待支付时计算
    status: 'pending', // pending | active | completed | cancelled
    createTime: db.serverDate(),
  };

  const bookingRes = await db.collection(BOOKINGS_COL).add({ data: bookingData });
  const bookingId = bookingRes._id;

  // 更新车位状态为已预订
  await db.collection(PARKING_SPOTS_COL).doc(spotId).update({
    data: {
      status: 'reserved',
      currentBookingId: bookingId,
    }
  });

  // 获取车场信息计算费用
  const lotRes = await db.collection(PARKING_LOTS_COL).doc(lotId).get();
  const totalFee = lotRes.data.pricePerHour * hoursNum;

  // 更新费用
  await db.collection(BOOKINGS_COL).doc(bookingId).update({
    data: { totalFee }
  });

  return {
    code: 0,
    msg: '预订成功',
    data: {
      bookingId,
      spotNo: spot.spotNo,
      startTime: startTs,
      endTime: endTs,
      hours: hoursNum,
      totalFee,
    }
  };
}

// 取消预订
async function cancelBooking(openid, bookingId) {
  if (!bookingId) return { code: -1, msg: '缺少预订ID' };

  const bookingRes = await db.collection(BOOKINGS_COL).doc(bookingId).get();
  const booking = bookingRes.data;

  if (booking.openid !== openid) {
    return { code: -1, msg: '无权操作此预订' };
  }

  if (!['pending', 'active'].includes(booking.status)) {
    return { code: -1, msg: '该预订无法取消' };
  }

  // 更新预订状态
  await db.collection(BOOKINGS_COL).doc(bookingId).update({
    data: {
      status: 'cancelled',
      cancelTime: db.serverDate(),
    }
  });

  // 释放车位
  await db.collection(PARKING_SPOTS_COL).doc(booking.spotId).update({
    data: {
      status: 'available',
      currentBookingId: null,
    }
  });

  return { code: 0, msg: '取消成功' };
}

// 获取我的预订列表
async function getMyBookings(openid) {
  const res = await db.collection(BOOKINGS_COL)
    .where({ openid })
    .orderBy('createTime', 'desc')
    .limit(50)
    .get();

  // 补充车场名称
  const bookings = res.data;
  const lotIds = [...new Set(bookings.map(b => b.lotId))];
  const lotMap = {};

  for (const lotId of lotIds) {
    try {
      const lotRes = await db.collection(PARKING_LOTS_COL).doc(lotId).get();
      lotMap[lotId] = lotRes.data;
    } catch (e) {
      lotMap[lotId] = { name: '未知车场' };
    }
  }

  return {
    code: 0,
    data: bookings.map(b => ({
      ...b,
      lotName: lotMap[b.lotId]?.name || '未知车场',
      lotAddress: lotMap[b.lotId]?.address || '',
    }))
  };
}

// 获取预订详情
async function getBookingDetail(openid, bookingId) {
  const bookingRes = await db.collection(BOOKINGS_COL).doc(bookingId).get();
  const booking = bookingRes.data;

  if (booking.openid !== openid) {
    return { code: -1, msg: '无权查看此预订' };
  }

  const lotRes = await db.collection(PARKING_LOTS_COL).doc(booking.lotId).get();

  return {
    code: 0,
    data: {
      ...booking,
      lot: lotRes.data,
    }
  };
}
