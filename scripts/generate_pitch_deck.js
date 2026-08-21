const pptxgen = require("pptxgenjs");
const path = require("path");
const fs = require("fs");

async function generatePitchDeck() {
  const pptx = new pptxgen();

  pptx.layout = "LAYOUT_16x9";
  pptx.author = "TrimScout Team";
  pptx.company = "TrimScout Inc.";
  pptx.title = "TrimScout Business Case & Investor Pitch Deck";
  pptx.subject = "The Reverse-Bidding Marketplace for New & In-Transit Automobiles";

  // Color Palette Constants
  const BG_DARK = "0B0F17";        // Rich obsidian / dark slate
  const BG_CARD = "161F30";        // Elevated card container
  const EMERALD = "10B981";        // Brand primary emerald
  const EMERALD_LIGHT = "34D399";  // Light emerald
  const TEXT_WHITE = "FFFFFF";     // Primary white
  const TEXT_MUTED = "94A3B8";     // Muted gray/slate
  const BORDER_COLOR = "25334D";   // Border stroke
  const ACCENT_BLUE = "3B82F6";    // Blue accent
  const ACCENT_ROSE = "F43F5E";    // Rose / Red for pain points

  // Helper for applying dark background to any slide
  const applySlideBackground = (slide, titleText, categoryText = "TRIMSCOUT BUSINESS CASE") => {
    slide.background = { color: BG_DARK };

    // Header Category Badge
    slide.addText(categoryText.toUpperCase(), {
      x: 0.8,
      y: 0.4,
      w: 8.0,
      h: 0.3,
      fontSize: 10,
      fontFace: "Arial",
      bold: true,
      color: EMERALD,
      charSpacing: 2,
    });

    // Main Header Title
    slide.addText(titleText, {
      x: 0.8,
      y: 0.68,
      w: 11.5,
      h: 0.65,
      fontSize: 24,
      fontFace: "Arial",
      bold: true,
      color: TEXT_WHITE,
    });

    // Subtle header separator line
    slide.addShape(pptx.shapes.LINE, {
      x: 0.8,
      y: 1.35,
      w: 11.73,
      h: 0,
      line: { color: BORDER_COLOR, width: 1 },
    });

    // Footer
    slide.addText("TrimScout Inc. • Confidential Pitch Deck • 2026", {
      x: 0.8,
      y: 7.0,
      w: 8.0,
      h: 0.3,
      fontSize: 9,
      fontFace: "Arial",
      color: TEXT_MUTED,
    });
  };

  // =========================================================================
  // SLIDE 1: COVER SLIDE
  // =========================================================================
  {
    const slide = pptx.addSlide();
    slide.background = { color: BG_DARK };

    // Brand Badge
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 1.0,
      y: 1.4,
      w: 3.2,
      h: 0.45,
      fill: { color: "064E3B" },
      line: { color: EMERALD, width: 1 },
      rectRadius: 0.1,
    });
    slide.addText("AUTOMOTIVE MARKETPLACE 2.0", {
      x: 1.0,
      y: 1.4,
      w: 3.2,
      h: 0.45,
      fontSize: 10,
      fontFace: "Arial",
      bold: true,
      color: EMERALD_LIGHT,
      align: "center",
      valign: "middle",
      charSpacing: 1.5,
    });

    // Title
    slide.addText("TrimScout", {
      x: 1.0,
      y: 2.1,
      w: 11.0,
      h: 1.2,
      fontSize: 54,
      fontFace: "Arial",
      bold: true,
      color: TEXT_WHITE,
    });

    // Subtitle
    slide.addText("The Reverse-Bidding Marketplace for New & In-Transit Automobiles", {
      x: 1.0,
      y: 3.3,
      w: 11.0,
      h: 0.6,
      fontSize: 20,
      fontFace: "Arial",
      bold: true,
      color: EMERALD_LIGHT,
    });

    // Pitch Summary
    slide.addText(
      "Eliminating dealership haggling by forcing franchise dealers to compete with sealed out-the-door price bids for verified, ready-to-buy consumers.",
      {
        x: 1.0,
        y: 4.1,
        w: 9.5,
        h: 0.9,
        fontSize: 14,
        fontFace: "Arial",
        color: TEXT_MUTED,
        lineSpacingMultiple: 1.2,
      }
    );

    // Metadata Card
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 1.0,
      y: 5.4,
      w: 11.33,
      h: 1.1,
      fill: { color: BG_CARD },
      line: { color: BORDER_COLOR, width: 1 },
      rectRadius: 0.1,
    });

    slide.addText([
      { text: "Business Case & Strategic Investor Deck\n", options: { bold: true, color: TEXT_WHITE, fontSize: 12 } },
      { text: "Target Market: $1.2T US Auto Market • Proprietary OTD Tax Engine • Real 3.6M+ Factory Allocations", options: { color: TEXT_MUTED, fontSize: 10.5 } },
    ], {
      x: 1.3,
      y: 5.55,
      w: 10.5,
      h: 0.8,
      fontFace: "Arial",
    });
  }

  // =========================================================================
  // SLIDE 2: THE PROBLEM (BUYER & DEALER PAIN POINTS)
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "The Broken Car Buying Experience");

    // Left Column: Buyer Pain Points
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.8,
      y: 1.6,
      w: 5.7,
      h: 5.0,
      fill: { color: BG_CARD },
      line: { color: "4C1D24", width: 1.5 },
      rectRadius: 0.1,
    });

    slide.addText("🚨 The Buyer Dilemma", {
      x: 1.1,
      y: 1.85,
      w: 5.1,
      h: 0.4,
      fontSize: 16,
      fontFace: "Arial",
      bold: true,
      color: ACCENT_ROSE,
    });

    const buyerPains = [
      "4.5 Hours Lost in Dealership F&I Offices: Exhausting haggling and negotiation stress.",
      "Opaque Pricing & Bait-and-Switch: Advertised prices routinely exclude $1,500–$3,500 in mandatory junk fees (paint protection, nitrogen, doc fees).",
      "Spam Telemarketing Nightmare: Submitting a lead on Autotrader/Cars.com unleashes 15+ daily calls and unwanted emails from aggressive BDCs.",
      "In-Transit Allocation Blindness: Buyers cannot easily find vehicles currently on the train or ship before they hit the dealer lot.",
    ];

    let yOffset = 2.4;
    buyerPains.forEach((pain) => {
      slide.addText(`• ${pain}`, {
        x: 1.1,
        y: yOffset,
        w: 5.1,
        h: 0.85,
        fontSize: 11,
        fontFace: "Arial",
        color: TEXT_WHITE,
        lineSpacingMultiple: 1.15,
      });
      yOffset += 0.95;
    });

    // Right Column: Dealer Pain Points
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 6.8,
      y: 1.6,
      w: 5.7,
      h: 5.0,
      fill: { color: BG_CARD },
      line: { color: "4C1D24", width: 1.5 },
      rectRadius: 0.1,
    });

    slide.addText("📉 The Dealership Dilemma", {
      x: 7.1,
      y: 1.85,
      w: 5.1,
      h: 0.4,
      fontSize: 16,
      fontFace: "Arial",
      bold: true,
      color: ACCENT_ROSE,
    });

    const dealerPains = [
      "$680+ Customer Acquisition Cost (CAC): Dealerships burn tens of thousands per month on low-quality third-party leads with <3% close rates.",
      "Flooring Cost Hemorrhage: Vehicles sitting >60 days on lot accumulate monthly bank interest penalties that eat all dealer profit margin.",
      "Wasted Sales Hours: BDC reps spend 80% of their workday chasing 'tire-kickers' who have no immediate financing approval or intent to buy.",
      "Price Race to the Bottom: Public discounts destroy brand margins; dealers need private, sealed bidding to move inventory discreetly.",
    ];

    yOffset = 2.4;
    dealerPains.forEach((pain) => {
      slide.addText(`• ${pain}`, {
        x: 7.1,
        y: yOffset,
        w: 5.1,
        h: 0.85,
        fontSize: 11,
        fontFace: "Arial",
        color: TEXT_WHITE,
        lineSpacingMultiple: 1.15,
      });
      yOffset += 0.95;
    });
  }

  // =========================================================================
  // SLIDE 3: THE SOLUTION (TRIMSCOUT VALUE PROPOSITION)
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "The TrimScout Solution: Reverse-Bidding & Buyer Shield");

    const pillars = [
      {
        title: "🛡️ 100% Anonymous Buyer Shield",
        desc: "Buyers are assigned encrypted aliases (e.g. Buyer #CA-4921). Dealers compete on price rather than bombarding buyers with unsolicited calls.",
        accent: EMERALD,
      },
      {
        title: "⚡ Sealed Reverse Auction",
        desc: "Verified franchise dealers submit competitive binding price offers. Dealers see their rank (e.g. Rank #2) and can counter-offer to win the sale.",
        accent: ACCENT_BLUE,
      },
      {
        title: "🔒 Guaranteed Out-The-Door (OTD)",
        desc: "Automated calculations factoring exact local city/county tax, state DMV title fees, and zero hidden dealer markups locked into a legally backed voucher.",
        accent: EMERALD_LIGHT,
      },
      {
        title: "🚢 3.6M+ Live Factory Allocations",
        desc: "Direct integration across on-lot, in-transit rail, and port allocation feeds. Buyers secure exactly the trim and packages they want before arrival.",
        accent: "A78BFA",
      },
    ];

    pillars.forEach((p, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 0.8 + col * 5.95;
      const y = 1.6 + row * 2.5;

      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: x,
        y: y,
        w: 5.75,
        h: 2.3,
        fill: { color: BG_CARD },
        line: { color: BORDER_COLOR, width: 1 },
        rectRadius: 0.1,
      });

      slide.addText(p.title, {
        x: x + 0.3,
        y: y + 0.25,
        w: 5.15,
        h: 0.35,
        fontSize: 14,
        fontFace: "Arial",
        bold: true,
        color: p.accent,
      });

      slide.addText(p.desc, {
        x: x + 0.3,
        y: y + 0.7,
        w: 5.15,
        h: 1.3,
        fontSize: 11,
        fontFace: "Arial",
        color: TEXT_WHITE,
        lineSpacingMultiple: 1.2,
      });
    });
  }

  // =========================================================================
  // SLIDE 4: MARKET OPPORTUNITY (TAM / SAM / SOM)
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "Massive Addressable Automotive Market");

    const marketTiers = [
      {
        label: "TAM: Total Addressable Market",
        val: "$1.2 Trillion",
        detail: "15.5M new vehicles sold annually in the United States at an average transaction price of $48,500.",
        color: EMERALD,
      },
      {
        label: "SAM: Serviceable Addressable Market",
        val: "$240 Billion",
        detail: "Digital-first auto shoppers (35% of total market) seeking online price discovery and transparent out-the-door guarantees.",
        color: ACCENT_BLUE,
      },
      {
        label: "SOM: Serviceable Obtainable Market",
        val: "$2.8 Billion",
        detail: "Capturing 2.5% of Tier-1 metropolitan allocations (CA, TX, FL, NY) via dealership transaction success fees and SaaS subscriptions.",
        color: EMERALD_LIGHT,
      },
    ];

    marketTiers.forEach((tier, idx) => {
      const x = 0.8 + idx * 4.0;
      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: x,
        y: 1.6,
        w: 3.75,
        h: 4.8,
        fill: { color: BG_CARD },
        line: { color: BORDER_COLOR, width: 1 },
        rectRadius: 0.1,
      });

      slide.addText(tier.label, {
        x: x + 0.25,
        y: 1.9,
        w: 3.25,
        h: 0.5,
        fontSize: 11,
        fontFace: "Arial",
        bold: true,
        color: TEXT_MUTED,
      });

      slide.addText(tier.val, {
        x: x + 0.25,
        y: 2.5,
        w: 3.25,
        h: 0.8,
        fontSize: 28,
        fontFace: "Arial",
        bold: true,
        color: tier.color,
      });

      slide.addText(tier.detail, {
        x: x + 0.25,
        y: 3.5,
        w: 3.25,
        h: 2.5,
        fontSize: 11.5,
        fontFace: "Arial",
        color: TEXT_WHITE,
        lineSpacingMultiple: 1.25,
      });
    });
  }

  // =========================================================================
  // SLIDE 5: MONETIZATION & BUSINESS MODEL
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "Diversified High-Margin Revenue Model");

    const streams = [
      {
        title: "1. Dealer Success Fee (Per Closed Sale)",
        rate: "$299 - $399",
        desc: "Charged to dealership upon customer redemption of the locked OTD Deal Voucher. Highly attractive compared to legacy $680+ CAC.",
      },
      {
        title: "2. Dealership Pro SaaS Subscription",
        rate: "$599 / mo per Rooftop",
        desc: "Unlocks CRM webhook auto-sync (Elead, DealerSocket), real-time SMS quick-bidding gateway, and competitor market pricing intelligence.",
      },
      {
        title: "3. Premium Buyer Concierge",
        rate: "$99 - $149 One-Time",
        desc: "Dedicated negotiation strategist, paperwork review, home driveway delivery coordination, and trade-in valuation protection.",
      },
      {
        title: "4. Ancillary Fintech & Trade-In Wholesale",
        rate: "$150 - $250 / Transaction",
        desc: "Origination referrals for captive finance/lease contracts, extended warranty marketplace, and digital trade-in wholesale auctions.",
      },
    ];

    streams.forEach((s, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const x = 0.8 + col * 5.95;
      const y = 1.6 + row * 2.5;

      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: x,
        y: y,
        w: 5.75,
        h: 2.3,
        fill: { color: BG_CARD },
        line: { color: BORDER_COLOR, width: 1 },
        rectRadius: 0.1,
      });

      slide.addText(s.title, {
        x: x + 0.3,
        y: y + 0.2,
        w: 5.15,
        h: 0.35,
        fontSize: 13,
        fontFace: "Arial",
        bold: true,
        color: TEXT_WHITE,
      });

      slide.addText(s.rate, {
        x: x + 0.3,
        y: y + 0.6,
        w: 5.15,
        h: 0.45,
        fontSize: 18,
        fontFace: "Arial",
        bold: true,
        color: EMERALD,
      });

      slide.addText(s.desc, {
        x: x + 0.3,
        y: y + 1.15,
        w: 5.15,
        h: 1.0,
        fontSize: 10.5,
        fontFace: "Arial",
        color: TEXT_MUTED,
        lineSpacingMultiple: 1.15,
      });
    });
  }

  // =========================================================================
  // SLIDE 6: COMPETITIVE LANDSCAPE & MOAT
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "Competitive Advantage & Defensible Moat");

    // Table Header & Rows
    const tableData = [
      [
        { text: "Platform Feature", options: { bold: true, fill: { color: "1E293B" }, color: TEXT_WHITE } },
        { text: "TrimScout", options: { bold: true, fill: { color: "064E3B" }, color: EMERALD_LIGHT } },
        { text: "TrueCar", options: { bold: true, fill: { color: "1E293B" }, color: TEXT_MUTED } },
        { text: "Carvana / Vroom", options: { bold: true, fill: { color: "1E293B" }, color: TEXT_MUTED } },
        { text: "Autotrader / Cars.com", options: { bold: true, fill: { color: "1E293B" }, color: TEXT_MUTED } },
      ],
      [
        { text: "Reverse Bidding Mechanism", options: { color: TEXT_WHITE } },
        { text: "✅ Real-time Multi-Dealer", options: { color: EMERALD, bold: true } },
        { text: "❌ Static MSRP Curve", options: { color: TEXT_MUTED } },
        { text: "❌ Fixed Non-negotiable", options: { color: TEXT_MUTED } },
        { text: "❌ No Bidding (Classifieds)", options: { color: TEXT_MUTED } },
      ],
      [
        { text: "100% Anonymous Buyer Shield", options: { color: TEXT_WHITE } },
        { text: "✅ Zero Telemarketing Spam", options: { color: EMERALD, bold: true } },
        { text: "❌ Sells Info to 3+ Dealers", options: { color: ACCENT_ROSE } },
        { text: "⚠️ Account Required", options: { color: TEXT_MUTED } },
        { text: "❌ Unleashes BDC Call Spam", options: { color: ACCENT_ROSE } },
      ],
      [
        { text: "In-Transit / Factory Allocations", options: { color: TEXT_WHITE } },
        { text: "✅ 3.6M+ Active Pipeline", options: { color: EMERALD, bold: true } },
        { text: "⚠️ Partial On-Lot Only", options: { color: TEXT_MUTED } },
        { text: "❌ Used Inventory Only", options: { color: ACCENT_ROSE } },
        { text: "⚠️ Inconsistent Feeds", options: { color: TEXT_MUTED } },
      ],
      [
        { text: "Guaranteed Out-The-Door Pricing", options: { color: TEXT_WHITE } },
        { text: "✅ Itemized Tax & DMV Locked", options: { color: EMERALD, bold: true } },
        { text: "❌ Dealer Adds Fees at Lot", options: { color: ACCENT_ROSE } },
        { text: "✅ Fixed Online Total", options: { color: TEXT_WHITE } },
        { text: "❌ Excludes Dealer Add-ons", options: { color: ACCENT_ROSE } },
      ],
      [
        { text: "Dealer Acquisition Efficiency", options: { color: TEXT_WHITE } },
        { text: "✅ $299 Success Fee Only", options: { color: EMERALD, bold: true } },
        { text: "⚠️ $399 Subscription + Leads", options: { color: TEXT_MUTED } },
        { text: "❌ Expensive Retail Overhead", options: { color: ACCENT_ROSE } },
        { text: "❌ $680+ Lead Waste Cost", options: { color: ACCENT_ROSE } },
      ],
    ];

    slide.addTable(tableData, {
      x: 0.8,
      y: 1.6,
      w: 11.73,
      h: 4.8,
      fontSize: 10,
      fontFace: "Arial",
      border: { color: BORDER_COLOR, width: 1 },
      align: "center",
      valign: "middle",
      colW: [2.53, 2.3, 2.3, 2.3, 2.3],
    });
  }

  // =========================================================================
  // SLIDE 7: FINANCIAL PROJECTIONS (3-YEAR ROADMAP)
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "Financial Forecast & Unit Economics");

    const years = [
      {
        year: "Year 1 (Regional Focus)",
        deals: "12,500 Funded Deals",
        dealers: "180 Dealership Rooftops",
        rev: "$4.8M Revenue",
        margin: "76% Gross Margin",
        cac: "CAC: $78 | LTV: $480",
      },
      {
        year: "Year 2 (Top 15 Metro Rollout)",
        deals: "68,000 Funded Deals",
        dealers: "750 Dealership Rooftops",
        rev: "$26.2M Revenue",
        margin: "82% Gross Margin",
        cac: "CAC: $65 | LTV: $580",
      },
      {
        year: "Year 3 (National Scaling)",
        deals: "245,000 Funded Deals",
        dealers: "2,400 Dealership Rooftops",
        rev: "$94.5M Revenue",
        margin: "87% Gross Margin",
        cac: "CAC: $52 | LTV: $670",
      },
    ];

    years.forEach((yr, idx) => {
      const x = 0.8 + idx * 4.0;
      slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
        x: x,
        y: 1.6,
        w: 3.75,
        h: 4.8,
        fill: { color: BG_CARD },
        line: { color: idx === 2 ? EMERALD : BORDER_COLOR, width: idx === 2 ? 1.5 : 1 },
        rectRadius: 0.1,
      });

      slide.addText(yr.year, {
        x: x + 0.25,
        y: 1.9,
        w: 3.25,
        h: 0.4,
        fontSize: 13,
        fontFace: "Arial",
        bold: true,
        color: idx === 2 ? EMERALD_LIGHT : TEXT_WHITE,
      });

      slide.addText(yr.rev, {
        x: x + 0.25,
        y: 2.4,
        w: 3.25,
        h: 0.7,
        fontSize: 24,
        fontFace: "Arial",
        bold: true,
        color: EMERALD,
      });

      const metrics = [
        `• Volume: ${yr.deals}`,
        `• Network: ${yr.dealers}`,
        `• Profitability: ${yr.margin}`,
        `• Unit Economics: ${yr.cac}`,
      ];

      let yOffset = 3.3;
      metrics.forEach((m) => {
        slide.addText(m, {
          x: x + 0.25,
          y: yOffset,
          w: 3.25,
          h: 0.5,
          fontSize: 11,
          fontFace: "Arial",
          color: TEXT_WHITE,
        });
        yOffset += 0.6;
      });
    });
  }

  // =========================================================================
  // SLIDE 8: THE ASK & USE OF FUNDS
  // =========================================================================
  {
    const slide = pptx.addSlide();
    applySlideBackground(slide, "Seed Round & Milestone Execution");

    // Left Box: The Investment Ask
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 0.8,
      y: 1.6,
      w: 5.7,
      h: 5.0,
      fill: { color: BG_CARD },
      line: { color: EMERALD, width: 1.5 },
      rectRadius: 0.1,
    });

    slide.addText("💰 The Seed Ask: $2.5 Million", {
      x: 1.1,
      y: 1.9,
      w: 5.1,
      h: 0.45,
      fontSize: 18,
      fontFace: "Arial",
      bold: true,
      color: EMERALD_LIGHT,
    });

    slide.addText("Use of Funds Allocation:", {
      x: 1.1,
      y: 2.5,
      w: 5.1,
      h: 0.35,
      fontSize: 12,
      fontFace: "Arial",
      bold: true,
      color: TEXT_WHITE,
    });

    const fundAllocations = [
      "45% ($1.12M) - Engineering & AI Autonomous Agents: Scaled dealer DMS/CRM connectors and mobile SMS bidding gateway.",
      "30% ($750K) - Dealer Partner B2B Sales: Onboarding regional dealer groups (Penske, Sonic, AutoNation) across top 10 metros.",
      "15% ($375K) - Consumer Acquisition & Viral Growth: Organic content, proof-of-savings referral loops, and geo-targeted digital campaigns.",
      "10% ($250K) - Legal, Compliance & Working Capital: Multi-state DMV licensing and automotive transaction compliance.",
    ];

    let yOffset = 2.9;
    fundAllocations.forEach((item) => {
      slide.addText(`• ${item}`, {
        x: 1.1,
        y: yOffset,
        w: 5.1,
        h: 0.8,
        fontSize: 10.5,
        fontFace: "Arial",
        color: TEXT_MUTED,
        lineSpacingMultiple: 1.15,
      });
      yOffset += 0.85;
    });

    // Right Box: 12-Month Key Milestones
    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 6.8,
      y: 1.6,
      w: 5.7,
      h: 5.0,
      fill: { color: BG_CARD },
      line: { color: BORDER_COLOR, width: 1 },
      rectRadius: 0.1,
    });

    slide.addText("🎯 12-Month Execution Milestones", {
      x: 7.1,
      y: 1.9,
      w: 5.1,
      h: 0.45,
      fontSize: 18,
      fontFace: "Arial",
      bold: true,
      color: ACCENT_BLUE,
    });

    const milestones = [
      "Q1: Launch Autonomous AI Buyer Agent & Dealer SMS Bidding Gateway in California & Texas.",
      "Q2: Onboard 250 Certified Franchise Dealership Rooftops across BMW, Toyota, Hyundai, Ford, and Honda.",
      "Q3: Achieve $250K Monthly Recurring Revenue (MRR) across Transaction Success Fees and Dealer Pro SaaS.",
      "Q4: Integrate Live Captive Lending (BMW FS, TFS) & Nationwide Driveway Delivery Network.",
    ];

    yOffset = 2.6;
    milestones.forEach((m) => {
      slide.addText(`• ${m}`, {
        x: 7.1,
        y: yOffset,
        w: 5.1,
        h: 0.85,
        fontSize: 11,
        fontFace: "Arial",
        color: TEXT_WHITE,
        lineSpacingMultiple: 1.15,
      });
      yOffset += 0.95;
    });
  }

  // =========================================================================
  // SLIDE 9: CONTACT & CLOSING
  // =========================================================================
  {
    const slide = pptx.addSlide();
    slide.background = { color: BG_DARK };

    slide.addText("Transforming How America Buys Cars.", {
      x: 1.0,
      y: 2.2,
      w: 11.0,
      h: 0.8,
      fontSize: 36,
      fontFace: "Arial",
      bold: true,
      color: TEXT_WHITE,
      align: "center",
    });

    slide.addText("Join us in building the transparent, reverse-bid future of automotive transactions.", {
      x: 1.0,
      y: 3.2,
      w: 11.0,
      h: 0.5,
      fontSize: 16,
      fontFace: "Arial",
      color: EMERALD_LIGHT,
      align: "center",
    });

    slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
      x: 3.5,
      y: 4.2,
      w: 6.33,
      h: 1.8,
      fill: { color: BG_CARD },
      line: { color: EMERALD, width: 1.5 },
      rectRadius: 0.1,
    });

    slide.addText([
      { text: "TrimScout Executive Team\n", options: { bold: true, color: TEXT_WHITE, fontSize: 14 } },
      { text: "Email: founders@trimscout.com\n", options: { color: EMERALD_LIGHT, fontSize: 12 } },
      { text: "Web: https://temporary-spry-scarlet-edtu38n.vercel.app\n", options: { color: TEXT_MUTED, fontSize: 11 } },
      { text: "GitHub: github.com/yhcnbgvtng-rgb/TrimScout", options: { color: TEXT_MUTED, fontSize: 10.5 } },
    ], {
      x: 3.8,
      y: 4.4,
      w: 5.73,
      h: 1.4,
      fontFace: "Arial",
      align: "center",
    });
  }

  // Save the PowerPoint presentation file
  const outDir = path.join(__dirname, "../public");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outputPath = path.join(outDir, "TrimScout_Business_Case_Pitch_Deck.pptx");
  await pptx.writeFile({ fileName: outputPath });

  // Also save a copy in the artifact directory
  const artifactDir = "/Users/paul/.gemini/antigravity/brain/031a48b8-0f62-4125-a9e2-c2487a48e93b";
  const artifactDeckPath = path.join(artifactDir, "TrimScout_Business_Case_Pitch_Deck.pptx");
  fs.copyFileSync(outputPath, artifactDeckPath);

  console.log(`✅ PowerPoint successfully generated at: ${outputPath}`);
  console.log(`✅ Artifact copy saved at: ${artifactDeckPath}`);
}

generatePitchDeck().catch((err) => {
  console.error("Failed to generate pitch deck:", err);
  process.exit(1);
});
