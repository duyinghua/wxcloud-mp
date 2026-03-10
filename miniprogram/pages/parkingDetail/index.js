// 车位预订详情页
Page({
  data: {
    lotId: '',
    lot: null,
    spots: [],
    rows: {},
    rowKeys: [],
    availableCount: 0,
    totalCount: 0,
    loading: true,
    selectedSpot: null,
    selectedHours: 2,
    hoursOptions: [1, 2, 3, 4, 6, 8, 12, 24],
    showBookingPanel: false,
    booking: false,
    estimatedFee: 0,
  },

  onLoad(options) {
    const { lotId } = options;
    this.setData({ lotId });
    this.loadSpots();
  },

  onShow() {
    if (this.data.lotId && !this.data.loading) {
      this.loadSpots(true);
    }
  },

  async loadSpots(silent = false) {
    if (!silent) this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'parkingManager',
        data: { action: 'getParkingSpots', lotId: this.data.lotId },
      });

      const result = res.result;
      if (result.code === 0) {
        const { lot, spots, rows, availableCount, totalCount } = result.data;
        const rowKeys = Object.keys(rows).sort();

        this.setData({
          lot,
          spots,
          rows,
          rowKeys,
          availableCount,
          totalCount,
          loading: false,
        });
      } else {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    }

    this.setData({ loading: false });
  },

  onSpotTap(e) {
    const { spot } = e.currentTarget.dataset;
    if (spot.status !== 'available') return;

    this.setData({
      selectedSpot: spot,
      showBookingPanel: true,
    });
    this.calcFee();
  },

  onHoursTap(e) {
    const { hours } = e.currentTarget.dataset;
    this.setData({ selectedHours: hours });
    this.calcFee();
  },

  calcFee() {
    const { lot, selectedHours } = this.data;
    if (lot && selectedHours) {
      this.setData({ estimatedFee: lot.pricePerHour * selectedHours });
    }
  },

  onClosePanel() {
    this.setData({ showBookingPanel: false, selectedSpot: null });
  },

  async onConfirmBook() {
    const { selectedSpot, lotId, selectedHours } = this.data;
    if (!selectedSpot) return;

    this.setData({ booking: true });
    wx.showLoading({ title: '预订中...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'parkingManager',
        data: {
          action: 'bookSpot',
          spotId: selectedSpot._id,
          lotId,
          hours: selectedHours,
          startTime: new Date().toISOString(),
        },
      });

      wx.hideLoading();
      const result = res.result;

      if (result.code === 0) {
        this.setData({ showBookingPanel: false, selectedSpot: null, booking: false });

        wx.showModal({
          title: '预订成功',
          content: `车位 ${result.data.spotNo} 已预订\n预计费用 ¥${result.data.totalFee}`,
          showCancel: false,
          confirmText: '查看预订',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/parkingBookings/index' });
            }
          }
        });

        // 刷新车位状态
        this.loadSpots(true);
      } else {
        this.setData({ booking: false });
        wx.showToast({ title: result.msg || '预订失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ booking: false });
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  onRefresh() {
    this.loadSpots(true);
  },
});
