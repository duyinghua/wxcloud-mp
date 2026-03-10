// 停车场列表页
Page({
  data: {
    lots: [],
    loading: true,
    refreshing: false,
    filterStatus: 'all', // all | available | full
  },

  onLoad() {
    this.loadParkingLots();
  },

  onShow() {
    // 每次显示时刷新数据（从预订页返回后更新车位数）
    if (!this.data.loading) {
      this.loadParkingLots(true);
    }
  },

  onPullDownRefresh() {
    this.loadParkingLots(true);
  },

  async loadParkingLots(silent = false) {
    if (!silent) {
      this.setData({ loading: true });
    }
    this.setData({ refreshing: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'parkingManager',
        data: { action: 'getParkingLots' },
      });

      const result = res.result;
      if (result.code === 0) {
        if (result.data.length === 0) {
          await this.initData();
        }
        const lots = result.data.map(lot => ({
          ...lot,
          occupancyRate: lot.totalSpots > 0
            ? Math.round(((lot.totalSpots - lot.availableSpots) / lot.totalSpots) * 100)
            : 0,
          statusText: lot.availableSpots === 0 ? '已满' : (lot.availableSpots <= 10 ? '紧张' : '充裕'),
          statusClass: lot.availableSpots === 0 ? 'full' : (lot.availableSpots <= 10 ? 'tight' : 'available'),
        }));
        this.setData({ lots, loading: false, refreshing: false });
      } else {
        this.showError(result.msg || '加载失败');
      }
    } catch (err) {
      console.error(err);
      // 首次使用时尝试初始化数据
      if (err.errMsg && err.errMsg.includes('collection')) {
        await this.initData();
      } else {
        this.showError('网络错误，请重试');
      }
    }

    this.setData({ loading: false, refreshing: false });
    wx.stopPullDownRefresh();
  },

  async initData() {
    wx.showLoading({ title: '初始化数据...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'parkingManager',
        data: { action: 'initData' },
      });
      wx.hideLoading();
      if (res.result.code === 0) {
        this.loadParkingLots();
      }
    } catch (e) {
      wx.hideLoading();
      this.showError('初始化失败: ' + e.message);
    }
  },

  onLotTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/parkingDetail/index?lotId=${id}`,
    });
  },

  onMyBookingsTap() {
    wx.navigateTo({ url: '/pages/parkingBookings/index' });
  },

  showError(msg) {
    wx.showToast({ title: msg, icon: 'none', duration: 2000 });
  },
});
