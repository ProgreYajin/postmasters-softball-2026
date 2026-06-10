/**
 * チーム・選手一覧ページ専用JavaScript
 */

const TeamsApp = (() => {
    // ==================== プライベート変数 ====================
    const teamIcons = ['⚾', '🥎', '⭐', '🏆', '🎯', '🔥', '⚡', '💪', '🎪'];

    // ==================== データ取得 ====================

    /**
     * APIからチームデータを取得
     */
    async function fetchTeams() {
        if (!CONFIG || !CONFIG.isStaffApiConfigured || !CONFIG.isStaffApiConfigured()) {
            showNoTeams('⚠️ API URLが設定されていません', 'js/config.jsのSTAFF_API_URLを設定してください。');
            return;
        }

        try {
            const timestamp = new Date().getTime();
            const response = await fetch(`${CONFIG.STAFF_API_URL}?type=teams&t=${timestamp}`, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-cache'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            displayTeams(data);

        } catch (error) {
            console.error('データ取得エラー:', error);
            showNoTeams(
                'データの読み込みに失敗しました',
                `エラー: ${error.message}<br><span style="font-size:0.9em;color:#666;margin-top:10px;">ブラウザのコンソールで詳細を確認してください</span>`
            );
        }
    }

    // ==================== レンダリング ====================

    /**
     * チームデータを表示
     */
    function displayTeams(data) {
        const container = document.getElementById('container');

        if (!data.teams || data.teams.length === 0) {
            showNoTeams('チームデータがありません');
            return;
        }

        let html = '';

        // ジャンプリンク作成
        html += `
            <div class="jump-links">
                <div class="jump-links-title">📋 チーム一覧 (${data.teams.length}チーム)</div>
                <div class="jump-links-grid">
        `;

        data.teams.forEach((team, index) => {
            const teamId = `team-${index}`;
            html += `<a href="#${teamId}" class="jump-link">${escapeHtml(team.name)}</a>`;
        });

        html += `
                </div>
            </div>
        `;

        // チームカード作成
        data.teams.forEach((team, index) => {
            const icon = teamIcons[index % teamIcons.length];
            const teamId = `team-${index}`;
            const playerCount = team.players.length;

            html += `
                <div class="team-card" id="${teamId}">
                    <div class="team-header">
                        <div class="team-icon">${icon}</div>
                        <div class="team-info">
                            <div class="team-name">${escapeHtml(team.name)}</div>
                            <div class="team-player-count">${playerCount}名</div>
                        </div>
                    </div>
                    
                    <div class="players-grid">
            `;

            team.players.forEach(player => {
                const photoHtml = '';

                html += `
                    <div class="player">
                        ${photoHtml}
                        <div class="player-info">
                            <div class="player-number">#${escapeHtml(player.number)}${player.note === '●' ? '<span class="player-senior-badge"></span>' : ''}</div>
                            <div class="player-name">${escapeHtml(player.name)}</div>
                            <div class="player-position">${escapeHtml(player.position)}</div>
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    /**
     * エラーメッセージ表示
     */
    function showNoTeams(title, message = '') {
        const container = document.getElementById('container');
        container.innerHTML = `
            <div class="no-teams">
                <h2>${escapeHtml(title)}</h2>
                ${message ? `<p>${message}</p>` : ''}
            </div>
        `;
    }

    // ==================== パブリックAPI ====================

    return {
        /**
         * アプリケーションを初期化
         */
        init() {
            fetchTeams();
        }
    };
})();

// ==================== 初期化 ====================
document.addEventListener('DOMContentLoaded', () => {
    TeamsApp.init();
});