const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

// 说明：当前用于“先让流程跑通”的占位实现。
// 你后续提供千问/大模型的真实接口字段后，这里再替换为真实请求。
exports.main = async (event) => {
  if (!event || !event.type) throw new Error("缺少 type");

  switch (event.type) {
    case "extractRecipe": {
      const { xiaohongshuUrl } = event;
      if (!xiaohongshuUrl) throw new Error("缺少 xiaohongshuUrl");

      // 从链接中尽量提取一个“菜名”作为示例
      let recipeName = "AI菜谱示例";
      try {
        const m = String(xiaohongshuUrl).match(/([^/?#]+)(?:[?#]|$)/);
        if (m && m[1]) recipeName = `菜谱-${m[1].slice(0, 8)}`;
      } catch (e) {}

      return {
        mock: true,
        recipeName,
        ingredients: [
          { name: "鸡蛋", amount: "2个" },
          { name: "番茄", amount: "1个" },
        ],
        seasonings: [{ name: "盐", amount: "3g" }],
        prepareSteps: ["备好食材（占位步骤）"],
        cookingSteps: ["按步骤烹饪（占位步骤）"],
      };
    }

    case "generateRecipeImage": {
      const { recipeName } = event;
      // 先返回占位，后续接入 AI 图片生成并写入云存储 fileID
      return {
        mock: true,
        recipeImg: "",
        recipeName: recipeName || "AI菜谱示例",
      };
    }

    default:
      throw new Error(`未知 type: ${event.type}`);
  }
};

