// Vercel Serverless Function - Simplified
import Anthropic from "@anthropic-ai/sdk";

const nodemailer = require('nodemailer');

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { fullName, businessName, email, businessType, description, goals, vibe } = req.body;

        if (!fullName || !businessName || !email || !businessType || !description) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        console.log(`🎨 Generating mockup for: ${fullName} - ${businessName}`);

        // Initialize Anthropic
        const anthropic = new Anthropic({ 
            apiKey: process.env.ANTHROPIC_API_KEY 
        });

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
    "designOverview": "2-3 sentence description of the overall design direction",
    "pages": ["array", "of", "recommended", "pages"],
    "features": ["array", "of", "key", "features", "5-7 items"],
    "colors": [
        {"name": "Primary", "hex": "#123456"},
        {"name": "Secondary", "hex": "#654321"},
        {"name": "Accent", "hex": "#abcdef"}
    ],
    "ctas": ["array", "of", "call-to-action", "ideas"],
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

        // Wait for HubSpot and SMS to complete
        await Promise.allSettled([
            sendToHubSpot(email, firstName, lastName, businessName),
            sendSMS(fullName, businessName, email, mockup.estimatedCost)
        ]);

        return res.json({ success: true, mockup });

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to generate mockup',
            error: error.message 
        });
    }
}

async function sendToHubSpot(email, firstName, lastName, businessName) {
    try {
        const hubspotData = {
            properties: {
                email, firstname: firstName, lastname: lastName,
                company: businessName, lifecyclestage: 'lead', hs_lead_status: 'NEW'
            }
        };

        const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(hubspotData)
        });

        if (response.ok) {
            console.log('📊 HubSpot: Contact created');
        } else if (response.status === 409) {
            console.log('📊 HubSpot: Contact exists (409)');
        }
    } catch (error) {
        console.error('📊 HubSpot failed:', error.message);
    }
}

async function sendSMS(fullName, businessName, email, cost) {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_PASSWORD
            }
        });

        await transporter.sendMail({
            from: '"Shoreline" <support@shorelinedevco.com>',
            to: '2036051211@vtext.com',
            subject: '',
            text: `🚨 NEW LEAD: ${fullName} - ${businessName} (${email}) - ${cost}`
        });
        console.log('📱 SMS sent');
    } catch (error) {
        console.error('📱 SMS failed:', error.message);
    }
}
