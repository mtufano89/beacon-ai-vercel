// Vercel Serverless Function - Ultra Simple Version
const Anthropic = require('@anthropic-ai/sdk');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

    try {
        const { fullName, businessName, email, businessType, description, goals, vibe } = req.body;

        if (!fullName || !businessName || !email || !businessType || !description) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        console.log(`🎨 Generating mockup for: ${fullName} - ${businessName}`);

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        const prompt = `You are an expert web designer at Shoreline Dev Co.

A potential client has requested a website mockup:

BUSINESS INFO:
- Name: ${businessName}
- Type: ${businessType}
- Description: ${description}
- Primary Goal: ${goals || 'not specified'}
- Desired Style: ${vibe || 'not specified'}

Create a detailed website design concept. Respond ONLY with valid JSON:

{
    "businessName": "${businessName}",
    "designOverview": "2-3 sentence description",
    "pages": ["array", "of", "pages"],
    "features": ["array", "of", "features", "5-7 items"],
    "colors": [
        {"name": "Primary", "hex": "#123456"},
        {"name": "Secondary", "hex": "#654321"},
        {"name": "Accent", "hex": "#abcdef"}
    ],
    "ctas": ["array", "of", "ctas"],
    "estimatedCost": "$399 - $999",
    "turnaroundTime": "2-3 days to 1-2 weeks"
}

PRICING: Use $399 for basic 3-page sites, $699 for most businesses (default), $999 for e-commerce/booking.

Return ONLY the JSON.`;

        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }]
        });

        const responseText = message.content[0].text;
        const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const mockup = JSON.parse(cleanedText);

        console.log(`✅ Mockup generated`);

        // HubSpot - synchronous
        try {
            console.log('📊 Sending to HubSpot...');
            
            const hubspotData = {
                properties: {
                    email: email,
                    firstname: firstName,
                    lastname: lastName,
                    company: businessName,
                    lifecyclestage: 'lead',
                    hs_lead_status: 'NEW'
                }
            };

            const hubspotResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(hubspotData)
            });

            if (hubspotResponse.ok) {
                const result = await hubspotResponse.json();
                console.log(`📊 ✅ HubSpot contact created: ${result.id}`);
            } else if (hubspotResponse.status === 409) {
                console.log(`📊 Contact already exists (409) - this is fine`);
            } else {
                const errorText = await hubspotResponse.text();
                console.log(`📊 ⚠️ HubSpot error: ${errorText}`);
            }
        } catch (hubspotError) {
            console.log(`📊 ❌ HubSpot failed: ${hubspotError.message}`);
        }

        return res.json({ success: true, mockup });

    } catch (error) {
        console.error('❌ Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to generate mockup',
            error: error.message 
        });
    }
}
