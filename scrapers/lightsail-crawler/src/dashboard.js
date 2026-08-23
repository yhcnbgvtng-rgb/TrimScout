import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // API: Export Full Inventory as CSV
    if (url.pathname === '/export.csv') {
        try {
            const raw = await fs.readFile(path.join(DATA_DIR, 'national_inventory_latest.json'), 'utf-8').catch(() =>
                fs.readFile(path.join(DATA_DIR, 'inventory_latest.json'), 'utf-8')
            );
            const data = JSON.parse(raw);

            const headers = ['VIN', 'Dealer', 'City', 'State', 'Type', 'Year', 'Make', 'Model', 'Trim', 'Price', 'OldPrice', 'PriceDiff', 'Mileage', 'Status', 'ChangeType', 'DaysOnLot', 'FirstSeen', 'LastSeen', 'URL'];
            const rows = data.map((v) => [
                v.vin || '',
                `"${(v.dealerName || '').replace(/"/g, '""')}"`,
                v.city || '',
                v.state || '',
                v.inventoryType || '',
                v.year || '',
                v.make || '',
                `"${(v.model || '').replace(/"/g, '""')}"`,
                `"${(v.trim || '').replace(/"/g, '""')}"`,
                v.price || '',
                v.oldPrice || '',
                v.priceDiff || 0,
                v.mileage || 0,
                v.status || '',
                v.changeType || '',
                v.daysOnLot || 0,
                v.firstSeen || '',
                v.lastSeen || '',
                v.url || '',
            ].join(','));

            const csv = [headers.join(','), ...rows].join('\n');
            res.writeHead(200, {
                'Content-Type': 'text/csv',
                'Content-Disposition': 'attachment; filename="porsche_inventory.csv"',
            });
            return res.end(csv);
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('No inventory data found yet. Run the scraper first.');
        }
    }

    // HTML Web Dashboard
    try {
        let changes = {};
        const changesFiles = await fs.readdir(path.join(DATA_DIR, 'daily_changes')).catch(() => []);
        if (changesFiles.length > 0) {
            const latestFile = changesFiles.sort().reverse()[0];
            const rawChanges = await fs.readFile(path.join(DATA_DIR, 'daily_changes', latestFile), 'utf-8');
            changes = JSON.parse(rawChanges);
        }

        let inventory = [];
        try {
            const rawInv = await fs.readFile(path.join(DATA_DIR, 'national_inventory_latest.json'), 'utf-8').catch(() =>
                fs.readFile(path.join(DATA_DIR, 'inventory_latest.json'), 'utf-8')
            );
            inventory = JSON.parse(rawInv);
        } catch {}

        const stats = changes.stats || {
            totalNationalInventory: inventory.filter((v) => v.status === 'ACTIVE').length,
            totalNewArrivals: inventory.filter((v) => v.changeType === 'NEW_ARRIVAL').length,
            totalPriceDrops: inventory.filter((v) => v.changeType === 'PRICE_DROP').length,
            totalSoldOrRemoved: inventory.filter((v) => v.status === 'SOLD_OR_REMOVED').length,
        };

        const priceDrops = inventory.filter((v) => v.changeType === 'PRICE_DROP' || (v.priceDiff && v.priceDiff < 0)).sort((a, b) => a.priceDiff - b.priceDiff);

        // Unique Dealers & States for Dropdown
        const dealers = [...new Set(inventory.map((v) => v.dealerName).filter(Boolean))].sort();
        const states = [...new Set(inventory.map((v) => v.state).filter(Boolean))].sort();

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Porsche Inventory & Multi-Category Market Intelligence</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: #0b0f19; color: #f8fafc; padding: 24px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px; flex-wrap: wrap; gap: 16px; }
        h1 { font-size: 24px; color: #f8fafc; display: flex; align-items: center; gap: 8px; }
        .btn { background: #10b981; color: #000; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 700; display: inline-block; transition: 0.2s; }
        .btn:hover { background: #059669; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
        .card { background: #131d31; border: 1px solid #1e293b; border-radius: 12px; padding: 18px; }
        .card-title { color: #94a3b8; font-size: 12px; font-weight: 700; text-transform: uppercase; }
        .card-value { font-size: 32px; font-weight: 800; margin-top: 6px; }
        .val-active { color: #10b981; }
        .val-drops { color: #f43f5e; }
        .val-new { color: #38bdf8; }
        .val-sold { color: #a855f7; }
        
        .section-title { font-size: 18px; font-weight: 700; margin: 24px 0 12px 0; color: #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        
        /* Multi-Category Filter Bar */
        .filter-panel { background: #131d31; border: 1px solid #1e293b; border-radius: 12px; padding: 18px; margin-bottom: 24px; }
        .filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
        .filter-group { display: flex; flex-direction: column; gap: 4px; }
        .filter-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; }
        .filter-select, .filter-input { background: #0b0f19; border: 1px solid #334155; border-radius: 8px; color: #f8fafc; padding: 8px 12px; font-size: 13px; outline: none; }
        .filter-select:focus, .filter-input:focus { border-color: #10b981; }

        .table-container { background: #131d31; border: 1px solid #1e293b; border-radius: 12px; overflow-x: auto; margin-bottom: 32px; }
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
        th { background: #1e293b; color: #94a3b8; padding: 12px 16px; font-weight: 600; text-transform: uppercase; font-size: 11px; }
        td { padding: 12px 16px; border-bottom: 1px solid #1e293b; }
        tr:hover { background: #1e293b; }
        .badge { padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; display: inline-block; }
        .badge-drop { background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.3); }
        .badge-new { background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
        .badge-used { background: rgba(168, 85, 247, 0.2); color: #a855f7; border: 1px solid rgba(168, 85, 247, 0.3); }
        a { color: #38bdf8; text-decoration: none; font-weight: 600; }
        a:hover { text-decoration: underline; }
        code { background: #0b0f19; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #cbd5e1; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🏎️ Porsche Multi-Category Market Intelligence</h1>
            <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Real-time inventory feed across all authorized US Porsche Centers</p>
        </div>
        <div style="display: flex; gap: 12px; align-items: center;">
            <a href="/export.csv" class="btn">📥 Export CSV (${inventory.length} Units)</a>
        </div>
    </div>

    <!-- Summary KPI Cards -->
    <div class="stats-grid">
        <div class="card">
            <div class="card-title">Live Active Inventory</div>
            <div class="card-value val-active">${stats.totalNationalInventory || inventory.length}</div>
        </div>
        <div class="card">
            <div class="card-title">Price Drops Active</div>
            <div class="card-value val-drops">${priceDrops.length}</div>
        </div>
        <div class="card">
            <div class="card-title">New Arrivals Today</div>
            <div class="card-value val-new">${stats.totalNewArrivals || 0}</div>
        </div>
        <div class="card">
            <div class="card-title">Sold / Off-Market</div>
            <div class="card-value val-sold">${stats.totalSoldOrRemoved || 0}</div>
        </div>
    </div>

    <!-- Multi-Category Filter Bar -->
    <div class="filter-panel">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #10b981; font-size: 13px; text-transform: uppercase;">🔍 Multi-Category Filters & Proximity Sorting</strong>
            <button onclick="resetFilters()" style="background: none; border: none; color: #38bdf8; cursor: pointer; font-size: 12px; font-weight: bold;">Reset Filters</button>
        </div>
        <div class="filter-grid">
            <div class="filter-group">
                <label class="filter-label">Sort Order</label>
                <select id="sortFilter" class="filter-select" onchange="applyAllFilters()" style="border-color: #10b981; color: #10b981; font-weight: bold;">
                    <option value="default">Default Order</option>
                    <option value="closest_to_zip">📍 Closest to ZIP Code</option>
                    <option value="price_desc">💰 Price: High to Low</option>
                    <option value="price_asc">💵 Price: Low to High</option>
                    <option value="price_drop_first">🔥 Largest Price Drop First</option>
                    <option value="days_desc">⏳ Days on Lot: Longest</option>
                </select>
            </div>
            <div class="filter-group">
                <label class="filter-label">Your Anchor ZIP Code</label>
                <input type="text" id="zipInput" class="filter-input" placeholder="07054" value="07054" oninput="applyAllFilters()" />
            </div>
            <div class="filter-group">
                <label class="filter-label">Search VIN / Keyword</label>
                <input type="text" id="searchInput" class="filter-input" placeholder="e.g. 911, Carrera, Lift, VIN..." onkeyup="applyAllFilters()" />
            </div>
            <div class="filter-group">
                <label class="filter-label">Model Series</label>
                <select id="modelFilter" class="filter-select" onchange="applyAllFilters()">
                    <option value="ALL">All Models</option>
                    <option value="911">911</option>
                    <option value="718">718 (Cayman / Boxster)</option>
                    <option value="Taycan">Taycan</option>
                    <option value="Panamera">Panamera</option>
                    <option value="Macan">Macan</option>
                    <option value="Cayenne">Cayenne</option>
                </select>
            </div>
            <div class="filter-group">
                <label class="filter-label">Condition</label>
                <select id="conditionFilter" class="filter-select" onchange="applyAllFilters()">
                    <option value="ALL">All Conditions</option>
                    <option value="NEW">New</option>
                    <option value="USED">Pre-Owned</option>
                    <option value="CERTIFIED">Certified Pre-Owned (CPO)</option>
                </select>
            </div>
            <div class="filter-group">
                <label class="filter-label">Dealership</label>
                <select id="dealerFilter" class="filter-select" onchange="applyAllFilters()">
                    <option value="ALL">All Dealerships (${dealers.length})</option>
                    ${dealers.map((d) => `<option value="${d}">${d}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group">
                <label class="filter-label">State / Region</label>
                <select id="stateFilter" class="filter-select" onchange="applyAllFilters()">
                    <option value="ALL">All States (${states.length})</option>
                    ${states.map((s) => `<option value="${s}">${s}</option>`).join('')}
                </select>
            </div>
            <div class="filter-group">
                <label class="filter-label">Days on Lot</label>
                <select id="daysFilter" class="filter-select" onchange="applyAllFilters()">
                    <option value="ALL">Any Days on Lot</option>
                    <option value="under_7">Fresh Arrival (&lt;7 Days)</option>
                    <option value="7_to_30">Normal (7 - 30 Days)</option>
                    <option value="over_45">High Leverage (&gt;45 Days)</option>
                </select>
            </div>
        </div>
    </div>

    <!-- Inventory Table -->
    <div class="section-title">
        <span>📋 Live Ingested Vehicles (<span id="tableCount">${inventory.length}</span> shown)</span>
    </div>
    <div class="table-container">
        <table id="inventoryTable">
            <thead>
                <tr>
                    <th>VIN</th>
                    <th>Status</th>
                    <th>Year & Model</th>
                    <th>Trim / Style</th>
                    <th>Dealer / Location</th>
                    <th>Condition</th>
                    <th>Price</th>
                    <th>Price Drop</th>
                    <th>Days on Lot</th>
                    <th>Link</th>
                </tr>
            </thead>
            <tbody id="tableBody">
                ${inventory.map((v) => `
                <tr data-vin="${v.vin || ''}"
                    data-model="${(v.model || '') + ' ' + (v.trim || '')}"
                    data-dealer="${v.dealerName || ''}"
                    data-city="${v.city || ''}"
                    data-state="${v.state || ''}"
                    data-type="${v.inventoryType || 'NEW'}"
                    data-price="${v.price || 0}"
                    data-days="${v.daysOnLot || 0}"
                    data-drop="${v.priceDiff && v.priceDiff < 0 ? 'yes' : 'no'}">
                    <td><code>${v.vin}</code></td>
                    <td><span class="badge ${v.changeType === 'NEW_ARRIVAL' ? 'badge-new' : v.changeType === 'PRICE_DROP' || (v.priceDiff && v.priceDiff < 0) ? 'badge-drop' : ''}">${v.changeType || v.status}</span></td>
                    <td><strong>${v.year || ''} ${v.model || ''}</strong></td>
                    <td style="color: #94a3b8;">${v.trim || v.bodyStyle || 'Standard'}</td>
                    <td>
                        <div>${v.dealerName || ''}</div>
                        <div style="font-size: 11px; color: #38bdf8;">${v.city ? v.city + ', ' : ''}${v.state || 'US'}</div>
                    </td>
                    <td><span class="badge ${v.inventoryType === 'NEW' ? 'badge-new' : v.inventoryType === 'CERTIFIED' ? 'badge-drop' : 'badge-used'}">${v.inventoryType || 'NEW'}</span></td>
                    <td style="font-weight: 800; color: #10b981;">${v.price ? '$' + v.price.toLocaleString() : 'Call'}</td>
                    <td>${v.priceDiff && v.priceDiff < 0 ? '<span class="badge badge-drop">-$' + Math.abs(v.priceDiff).toLocaleString() + '</span>' : '—'}</td>
                    <td style="font-weight: 700; color: ${(v.daysOnLot || 0) >= 45 ? '#fbbf24' : '#94a3b8'};">${v.daysOnLot || 14}d</td>
                    <td>${v.url ? '<a href="' + v.url + '" target="_blank">View Lot →</a>' : '—'}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>

    <script>
        function resetFilters() {
            document.getElementById("searchInput").value = "";
            document.getElementById("modelFilter").value = "ALL";
            document.getElementById("conditionFilter").value = "ALL";
            document.getElementById("dealerFilter").value = "ALL";
            document.getElementById("stateFilter").value = "ALL";
            document.getElementById("daysFilter").value = "ALL";
            document.getElementById("sortFilter").value = "default";
            document.getElementById("zipInput").value = "07054";
            applyAllFilters();
        }

        function applyAllFilters() {
            var search = document.getElementById("searchInput").value.toUpperCase();
            var model = document.getElementById("modelFilter").value.toUpperCase();
            var cond = document.getElementById("conditionFilter").value.toUpperCase();
            var dealer = document.getElementById("dealerFilter").value.toUpperCase();
            var state = document.getElementById("stateFilter").value.toUpperCase();
            var days = document.getElementById("daysFilter").value;
            var sort = document.getElementById("sortFilter").value;

            var tbody = document.getElementById("tableBody");
            var rows = Array.from(tbody.getElementsByTagName("tr"));
            var visibleCount = 0;

            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                var text = (r.textContent || r.innerText).toUpperCase();
                var rModel = (r.getAttribute("data-model") || "").toUpperCase();
                var rDealer = (r.getAttribute("data-dealer") || "").toUpperCase();
                var rState = (r.getAttribute("data-state") || "").toUpperCase();
                var rType = (r.getAttribute("data-type") || "").toUpperCase();
                var rDays = parseInt(r.getAttribute("data-days") || "0", 10);

                var match = true;

                if (search && text.indexOf(search) === -1) match = false;
                if (model !== "ALL" && rModel.indexOf(model) === -1) match = false;
                if (cond !== "ALL" && rType.indexOf(cond) === -1) match = false;
                if (dealer !== "ALL" && rDealer.indexOf(dealer) === -1) match = false;
                if (state !== "ALL" && rState.indexOf(state) === -1) match = false;
                if (days === "under_7" && rDays > 7) match = false;
                if (days === "7_to_30" && (rDays < 7 || rDays > 30)) match = false;
                if (days === "over_45" && rDays < 45) match = false;

                r.style.display = match ? "" : "none";
                if (match) visibleCount++;
            }

            // Sorting
            if (sort === "price_desc") {
                rows.sort(function(a, b) {
                    var pA = parseFloat(a.getAttribute("data-price") || 0);
                    var pB = parseFloat(b.getAttribute("data-price") || 0);
                    return pB - pA;
                });
                rows.forEach(function(r) { tbody.appendChild(r); });
            } else if (sort === "price_asc") {
                rows.sort(function(a, b) {
                    var pA = parseFloat(a.getAttribute("data-price") || 0);
                    var pB = parseFloat(b.getAttribute("data-price") || 0);
                    if (pA === 0) pA = Infinity;
                    if (pB === 0) pB = Infinity;
                    return pA - pB;
                });
                rows.forEach(function(r) { tbody.appendChild(r); });
            } else if (sort === "days_desc") {
                rows.sort(function(a, b) {
                    var dA = parseInt(a.getAttribute("data-days") || 0, 10);
                    var dB = parseInt(b.getAttribute("data-days") || 0, 10);
                    return dB - dA;
                });
                rows.forEach(function(r) { tbody.appendChild(r); });
            }

            document.getElementById("tableCount").innerText = visibleCount;
        }
    </script>
</body>
</html>`;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Internal Server Error: ${err.message}`);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🏎️ Porsche Multi-Category Dashboard active at http://0.0.0.0:${PORT}`);
});
