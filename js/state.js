export const AppState = {
  rawChannels: [], filteredChannels: [], filters: { search: '', playlist: '', group: '' },
  setChannels(data) { this.rawChannels = data; this.applyFilters(); },
  setFilters(newFilters) { this.filters = { ...this.filters, ...newFilters }; this.applyFilters(); },
  applyFilters() {
    const { search, playlist, group } = this.filters;
    const sLower = search.toLowerCase();
    this.filteredChannels = this.rawChannels.filter(ch => {
      const mSearch = !search || ch.name.toLowerCase().includes(sLower) || ch.groupTitle.toLowerCase().includes(sLower);
      const mPlay = !playlist || ch.sourcePlaylist === playlist;
      const mGroup = !group || ch.groupTitle === group;
      return mSearch && mPlay && mGroup;
    });
    document.dispatchEvent(new CustomEvent('state:changed'));
  }
};