/**
 * 会場案内・アクセスページ専用JavaScript
 */

const VenueApp = (() => {
    // ==================== パブリックAPI ====================

    return {
        /**
         * Googleマップを開く
         */
        openMap() {
            window.open('https://www.google.com/maps/search/?api=1&query=佐倉市岩名運動公園', '_blank');
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', function() {
    // 会場案内ページ固有の初期化処理をここに記述
    console.log('会場案内・アクセスページが読み込まれました');
});