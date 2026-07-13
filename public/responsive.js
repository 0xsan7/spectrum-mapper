class ResponsiveManager {
  static init() {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    mediaQuery.addListener(() => this.apply());
    this.apply();
  }

  static apply() {
    const main = document.querySelector('main');
    if (window.innerWidth < 768) {
      main.style.flexDirection = 'column';
    } else {
      main.style.flexDirection = 'row';
    }
  }
}

window.addEventListener('load', () => ResponsiveManager.init());
