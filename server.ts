import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Initialize the GoogleGenAI client with key from environment
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON bodies up to 10MB
  app.use(express.json({ limit: "10mb" }));

  // API Endpoint: Intelligent business analysis chat in Arabic
  app.post("/api/chat", async (req, res) => {
    try {
      const { message, data, promoters, history = [] } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      const ai = getGeminiClient();
      if (!ai) {
        return res.status(500).json({
          error: "API_KEY_MISSING",
          messageArabic: "تنبيه: مفتاح الـ API للذكاء الاصطناعي (GEMINI_API_KEY) غير متاح حالياً. يرجى إضافته في إعدادات المنصة لتفعيل الردود الذكية المتقدمة."
        });
      }

      // Format current dataset structure as part of the context
      let datasetContext = "لا توجد بيانات مرفوعة حالياً.";
      if (data && Array.isArray(data) && data.length > 0) {
        datasetContext = data.map((row: any, index: number) => {
          return `${index + 1}. المشرف: ${row.name || 'غير معروف'} | المستهدف: ${row.target || 0} | المبيعات الفعلية: ${row.actual || 0} | نسبة الإنجاز الحالية: ${row.achievementRate || 0}% | عدد المروجين: ${row.promoters || 0} | التنبؤ للمستقبل: نسبة إنجاز متوقعة ${row.predictedAchievement || 0}% (${row.predictedTrend || 'ثابت'})`;
        }).join("\n");
      }

      // Format promoters structure if available
      let promotersContext = "";
      if (promoters && Array.isArray(promoters) && promoters.length > 0) {
        promotersContext = "\n[بيانات المروجين الميدانيين (Promoters)]\n" + promoters.map((row: any, index: number) => {
          return `${index + 1}. كود المروج: ${row.code || 'مجهول'} | المروج: ${row.name || 'غير معروف'} | المشرف المسؤول: ${row.supervisor || 'غير معروف'} | المستهدف: ${row.target || 0} | المبيعات الفعلية: ${row.actual || 0} | نسبة التحقيق: ${row.achieveRate || 0}%`;
        }).join("\n");
      }

      const systemInstruction = `أنت "المساعد الذكي للتحليل والتنبؤ بالمبيعات" - خبير مالي ومحلل بيانات أعمال ذكي ومستشار إداري محترف.
تتحدث وتجيب باللغة العربية الفصحى بشكل دقيق، موجز، مهني، ومقنع للغاية، مع تنسيق النص باستخدام نقاط وفقرات مريحة للعين.

لديك البيانات الحالية الخاصة بأداء مشرفي المبيعات وتوقعاتهم المستقبلية (تم حسابها بنظام تعلّم الآلة):
[بيانات مبيعات المشرفين]
${datasetContext}
${promotersContext}

التعليمات الهامة لإجاباتك:
1. اعتمد دائماً على الأرقام والنسب المذكورة في البيانات أعلاه للإجابة على سؤال المستخدم. لا تخترع أرقاماً غير موجودة.
2. إذا سأل المستخدم عن أداء مشرف معين، قم بمقارنة أدائه بمتوسط الشركة (المستهدف والمبيعات ونشاط المروجين) لتقدم تشخيصاً ذكياً (Diagnostic Analytics).
3. إذا سأل المستخدم عن أداء المروجين أو كود مروج معين أو ترتيب المروجين الميدانيين أو التابعين لمشرف معين، استخدم [بيانات المروجين الميدانيين] المتاحة أعلاه لتزويده بالإجابة الشافية والدقيقة للغاية بالأسماء والمبيعات ونسب التحقيق.
4. ركّز على تقديم تحليلات قيمة (مثلاً: تفسير لماذا مشرف معين متوقع أن ينخفض أدائه كارتفاع المستهدف بشكل مبالغ فيه أو قلة عدد المروجين النشطين).
5. استخدم نبرة إيجابية، مشجعة، ومهنية تناسب المدراء التنفيذيين والشركات الاستشارية الكبرى.
6. لا تذكر أبداً في إجاباتك أي مصطلحات تقنية مثل "ملف JSON" أو "قاعدة بيانات" أو "الواجهة البرمجية" أو تفاصيل برمجية داخلية للبرنامج. تحدث كإنسان مستشار جالس مع المدير.`;

      // Structure contents with history for full conversation flow
      const contents = [
        ...history.map((h: any) => ({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.content }]
        })),
        {
          role: "user",
          parts: [{ text: message }]
        }
      ];

      // Helper function with exponential backoff retry and model fallback
      const generateWithRetryAndFallback = async (aiClient: any, contentsList: any, instructions: string) => {
        const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
        let lastError: any = null;

        for (const model of modelsToTry) {
          let attempts = 3;
          let delay = 1000; // start with 1 second delay

          for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
              console.log(`Calling Gemini API using model: ${model} (Attempt ${attempt}/${attempts})...`);
              const response = await aiClient.models.generateContent({
                model: model,
                contents: contentsList,
                config: {
                  systemInstruction: instructions,
                  temperature: 0.7,
                }
              });
              
              if (response && response.text) {
                console.log(`Successfully generated content using model: ${model}`);
                return response.text;
              }
            } catch (err: any) {
              lastError = err;
              console.warn(`Attempt ${attempt} failed with model ${model}. Error:`, err.message || err);
              
              // Only retry if we have more attempts left
              if (attempt < attempts) {
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2; // exponential backoff
              }
            }
          }
          console.warn(`All attempts failed for model: ${model}. Trying next available fallback model...`);
        }

        throw lastError || new Error("All models failed to generate a response");
      };

      const responseText = await generateWithRetryAndFallback(ai, contents, systemInstruction);
      res.json({ text: responseText });

    } catch (error: any) {
      console.error("Gemini API Error in Server:", error);
      res.status(500).json({
        error: "INTERNAL_SERVER_ERROR",
        message: error.message,
        messageArabic: "حدث خطأ أثناء معالجة طلبك عبر الذكاء الاصطناعي. يرجى المحاولة مرة أخرى."
      });
    }
  });

  // Serve static assets with Vite in development, or standard express static in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware integrated.");
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving compiled static assets in production.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express server is listening on port ${PORT}`);
  });
}

startServer();
