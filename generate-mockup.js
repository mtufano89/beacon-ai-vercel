// Vercel Serverless Function for Beacon AI
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');

// API Keys from environment variables
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASSWORD = process.env.GMAIL_PASSWORD;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const HUBSPOT_API_URL = 'https://api.hubapi.com/crm/v3/objects/contacts';

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: GMAIL_USER,
        pass: GMAIL_PASSWORD
    }
});

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        const { 
            fullName,
            businessName, 
            email, 
            businessType, 
            description, 
            goals, 
            vibe 
        } = req.body;

        // Validate
        if (!fullName || !businessName || !email || !businessType || !description) {
            return res.status(400).json({
                success: false,
                message: 'Please fill in all required fields'
            });
        }

        // Split name into first and last
        const nameParts = fullName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        console.log(`🎨 Generating mockup for: ${fullName} - ${businessName} (${email})`);

        // Create AI prompt
        const prompt = `You are an expert web designer at Shoreline Dev Co, a professional web development agency.

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
    "designOverview": "2-3 sentence description of the overall design direction and how it serves their business goals",
    "pages": ["array", "of", "recommended", "pages"],
    "features": ["array", "of", "key", "website", "features", "5-7 items"],
    "colors": [
        {"name": "Primary", "hex": "#123456"},
        {"name": "Secondary", "hex": "#654321"},
        {"name": "Accent", "hex": "#abcdef"}
    ],
    "ctas": ["array", "of", "call-to-action", "ideas"],
    "estimatedCost": "$399 - $999",
    "turnaroundTime": "2-3 days to 1-2 weeks"
}

PRICING RULES (FOLLOW EXACTLY):

Use "$399 (Starter Package)" + "2-3 days" ONLY if the business needs exactly 3 pages: Home, About, Contact. Nothing more.
Example: "Small consulting firm, just need basic web presence"

Use "$699 (Business Package)" + "5-7 days" for MOST businesses - this is your DEFAULT.
Examples: 
- Restaurant with menu page
- Service business with services page
- Gym with classes page
- Retail store with products page
- Any business with 4-6 pages
- Any business that mentions gallery, portfolio, team, FAQ, services

Use "$999 (Premium Package)" + "1-2 weeks" ONLY if they explicitly say:
- "sell online" or "e-commerce" or "shopping cart"
- "booking system" or "reservations"
- "member login" or "user accounts"
Examples that need Premium:
- "Online store selling handmade jewelry"
- "Salon with online booking"
- "Gym with member portal"

CRITICAL: If you're unsure, choose Business Package ($699). Premium should be rare.

REQUIREMENTS:
- Be specific and professional
- Match recommendations to their business type
- Focus on business outcomes
- Make them excited about the potential

Return ONLY the JSON.`;

        // Call Claude AI
        const message = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 2000,
            messages: [{
                role: 'user',
                content: prompt
            }]
        });

        // Parse response
        const responseText = message.content[0].text;
        const cleanedText = responseText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();
        
        const mockup = JSON.parse(cleanedText);

        console.log(`✅ Mockup generated for ${email}`);

        // Send to HubSpot (in parallel with response)
        sendToHubSpot(email, firstName, lastName, businessName, fullName, mockup);

        // Send SMS notification (in parallel)
        sendSMS(fullName, businessName, email, mockup);

        // Return mockup immediately
        res.json({
            success: true,
            mockup: mockup
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate mockup',
            error: error.message
        });
    }
};

// Helper function for HubSpot (non-blocking)
async function sendToHubSpot(email, firstName, lastName, businessName, fullName, mockup) {
    try {
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

        // Try to create
        let hubspotResponse = await fetch(HUBSPOT_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(hubspotData)
        });

        if (hubspotResponse.ok) {
            const hubspotResult = await hubspotResponse.json();
            console.log(`📊 Contact created in HubSpot: ${email} (ID: ${hubspotResult.id})`);
        } else if (hubspotResponse.status === 409) {
            // Contact exists - update it
            console.log(`📊 Contact exists, updating: ${email}`);
            
            const searchResponse = await fetch(
                `https://api.hubapi.com/crm/v3/objects/contacts/search`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        filterGroups: [{
                            filters: [{
                                propertyName: 'email',
                                operator: 'EQ',
                                value: email
                            }]
                        }]
                    })
                }
            );

            if (searchResponse.ok) {
                const searchResult = await searchResponse.json();
                if (searchResult.results && searchResult.results.length > 0) {
                    const contactId = searchResult.results[0].id;
                    
                    const updateResponse = await fetch(
                        `${HUBSPOT_API_URL}/${contactId}`,
                        {
                            method: 'PATCH',
                            headers: {
                                'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(hubspotData)
                        }
                    );

                    if (updateResponse.ok) {
                        console.log(`📊 ✅ Contact updated in HubSpot: ${email} (ID: ${contactId})`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('📊 HubSpot failed:', error.message);
    }
}

// Helper function for SMS (non-blocking)
async function sendSMS(fullName, businessName, email, mockup) {
    try {
        await transporter.sendMail({
            from: '"Shoreline Lead Alert" <support@shorelinedevco.com>',
            to: '2036051211@vtext.com',
            subject: '',
            text: `🚨 NEW LEAD: ${fullName} - ${businessName} (${email}) - ${mockup.estimatedCost}`
        });
        console.log(`📱 SMS notification sent`);
    } catch (error) {
        console.error('📱 SMS failed:', error.message);
    }
}
