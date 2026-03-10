// 我的预订页
Page({
  data: {
    bookings: [],
    loading: true,
    activeTab: 'active', // active | history
    activeBookings: [],
    historyBookings: [],
    cancellingId: '',
  },

  onLoad() {
    this.loadBookings();
  },

  onShow() {
    this.loadBookings(true);
  },

  async loadBookings(silent = false) {
    if (!silent) this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'parkingManager',
        data: { action: 'getMyBookings' },
      });

      const result = res.result;
      if (result.code === 0) {
        const bookings = result.data.map(b => ({
          ...b,
          startTimeStr: this.formatTime(b.startTime),
          endTimeStr: this.formatTime(b.endTime),
          createTimeStr: this.formatTime(b.createTime),
          statusText: this.getStatusText(b.status),
          statusClass: b.status,
        }));

        const activeBookings = bookings.filter(b => ['pending', 'active'].includes(b.status));
        const historyBookings = bookings.filter(b => ['completed', 'cancelled'].includes(b.status));

        this.setData({
          bookings,
          activeBookings,
          historyBookings,
          loading: false,
        });
      } else {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
        this.setData({ loading: false });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '网络错误', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onTabSwitch(e) {
    const { tab } = e.currentTarget.dataset;
    this.setData({ activeTab: tab });
  },

  onCancelTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.showModal({
      title: '取消预订',
      content: '确定要取消这个预订吗？',
      confirmText: '确认取消',
      confirmColor: '#E94560',
      success: async (res) => {
        if (res.confirm) {
          await this.cancelBooking(id);
        }
      }
    });
  },

  async cancelBooking(bookingId) {
    this.setData({ cancellingId: bookingId });
    wx.showLoading({ title: '取消中...' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'parkingManager',
        data: { action: 'cancelBooking', bookingId },
      });

      wx.hideLoading();
      const result = res.result;

      if (result.code === 0) {
        wx.showToast({ title: '已取消', icon: 'success' });
        this.loadBookings(true);
      } else {
        wx.showToast({ title: result.msg || '取消失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '网络错误', icon: 'none' });
    }

    this.setData({ cancellingId: '' });
  },

  onGoBook() {
    wx.navigateTo({ url: '/pages/parkingList/index' });
  },

  formatTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '--';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  getStatusText(status) {
    const map = {
      pending: '待使用',
      active: '使用中',
      completed: '已完成',
      cancelled: '已取消',
    };
    return map[status] || status;
  },
});
