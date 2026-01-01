const pool = require('../models/db');
const sendEmail = require("../utils/sendEmail");
const webpush = require("../utils/webpushConfig");


// const webpush = require("web-push");

// webpush.setVapidDetails(
//   "mailto:your@email.com", // update this to your contact
//   process.env.VAPID_PUBLIC_KEY,
//   process.env.VAPID_PRIVATE_KEY
// );

exports.showSearchArticles = async (req, res) => {
  try {
    const search = req.query.search;
    const infoResult = await pool.query(
      "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};
    // Step 3: Stats
    const totalResult = await pool.query("SELECT COUNT(*) FROM pathways");
    const totalArticle = parseInt(totalResult.rows[0].count);
    let articlesResult;

    if (search) {
      articlesResult = await pool.query(
        "SELECT * FROM articles WHERE LOWER(title) LIKE $1 ORDER BY created_at DESC",
        [`%${search.toLowerCase()}%`]
      );
    } else {
      articlesResult = await pool.query(
        "SELECT * FROM articles ORDER BY created_at DESC"
      );
    }

    res.render("admin/articles", {
      info,
      totalArticle,
      title: "All Articles",
      articles: articlesResult.rows,
      search, // Pass back to template for input field value
    });
  } catch (err) {
    console.error('Error searching articles:', err);
    res.status(500).send('Server Error');
  }
};

exports.saveArticle = async (req, res) => {
  const { title, content } = req.body;
  const image_url = req.file ? req.file.path : null;
  const created_at3 = new Date(); // Create timestamp in JS

  // await pool.query(
  //   // 'INSERT INTO articles (title, content, image_url) VALUES ($1, $2, $3)',
  //   // [title, content, image_url]
  //   "INSERT INTO articles (title, content, image_url, created_at3) VALUES ($1, $2, $3, $4) RETURNING id",
  //   [title, content, image_url, created_at3]
  // );

  const insertResult = await pool.query(
    "INSERT INTO articles (title, content, image_url, created_at3) VALUES ($1, $2, $3, $4) RETURNING id",
    [title, content, image_url, created_at3]
  );

  const articleId = insertResult.rows[0].id;

  const articleUrl = `https://cschurchonline.org/articles/${articleId}`;
  const resultUsers = await pool.query(
    "SELECT email FROM users2 WHERE email IS NOT NULL"
  );
  const emails = resultUsers.rows.map((row) => row.email);

  // Compose HTML message
  // let message = "Dear Beloved, Article as been posted click on the link to view";
  // let htmlMsg = `<div>${message} <p>${articleUrl}</div>`
  // let htmlMsg = `<div style="font-family: Arial, sans-serif;"> <p>${message}</p> <p><a href="${articleUrl}" style="display:inline-block;padding:10px 15px;background:#007BFF;color:#fff;text-decoration:none;border-radius:4px;">Read Article</a></p></div>` ;

  let message =
    "Dear Beloved, an article has been posted. Click the link below to read it.";
  let htmlMsg = `<div><p>${message}</p><p><a href="${articleUrl}" target="_blank">${title}</a></p>`;


  if (image_url) {
    htmlMsg += `<div style="margin-top:20px;"><img src="${image_url}" alt="Article Image" style="max-width:100%;border-radius:8px;"></div>`;
  }

  htmlMsg += `</div>`;

  // Send to all users
  // for (const email of emails) {
  //   await sendEmail(email, title, htmlMsg);
  // }



  const subsResult = await pool.query("SELECT * FROM subscriptions");
  const payload = JSON.stringify({
    title: title,
    message: "A new article has been posted!",
    url: articleUrl,
  });

  for (const sub of subsResult.rows) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: sub.keys,
    };

    try {
      await webpush.sendNotification(pushSubscription, payload);
    } catch (err) {
      console.error("Failed to send push:", err);
    }
  }

  res.redirect('/admin/articles');
};

exports.showEditForm = async (req, res) => {
    const id = req.params.id;
    const result = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Article not found');
    }
    res.render('admin/editArticle', { article: result.rows[0], title: 'Edit article'  });
  };
  
  exports.updateArticle = async (req, res) => {
    const id = req.params.id;
    const { title, content } = req.body;
    const image_url = req.file ? req.file.path : null;
  
    if (image_url) {
      // Update all fields including image_url
      await pool.query(
        'UPDATE articles SET title = $1, content = $2, image_url = $3 WHERE id = $4',
        [title, content, image_url, id]
      );
    } else {
      // Update title and content only
      await pool.query(
        'UPDATE articles SET title = $1, content = $2 WHERE id = $3',
        [title, content, id]
      );
    }
  
    res.redirect('/admin/articles');
  };
  
  exports.deleteArticle = async (req, res) => {
    const id = req.params.id;
    await pool.query('DELETE FROM articles WHERE id = $1', [id]);
    res.redirect('/admin/articles');
  };
  

//   exports.showArticles = async (req, res) => {
//     try {
//       const infoResult = await pool.query(
//         "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
//       );
//       const info = infoResult.rows[0] || {};

//       const articlesResult = await pool.query(
//         "SELECT * FROM articles ORDER BY created_at3 DESC"
//       );
//       const articles = articlesResult.rows;

//       // Step 3: Stats
//       const totalResult = await pool.query("SELECT COUNT(*) FROM articles");
//         const totalArticle = parseInt(totalResult.rows[0].count);
//         if (search) {
//           articlesResult = await pool.query(
//             "SELECT * FROM articles WHERE LOWER(title) LIKE $1 ORDER BY created_at DESC",
//             [`%${search.toLowerCase()}%`]
//           );
//         } else {
//           articlesResult = await pool.query(
//             "SELECT * FROM articles ORDER BY created_at DESC"
//           );
//         }
//       res.render("admin/articles", { info, totalArticle, articles, title: "Article" });
//     } catch (err) {
//       console.error(err);
//       res.status(500).send('Server Error');
//     }
//   };

exports.showArticles = async (req, res) => {
  try {
    const search = req.query.search || ""; // ✅ define the variable

    const infoResult = await pool.query(
      "SELECT * FROM ministry_info ORDER BY id DESC LIMIT 1"
    );
    const info = infoResult.rows[0] || {};

    let articlesResult;

    if (search) {
      articlesResult = await pool.query(
        "SELECT * FROM articles WHERE LOWER(title) LIKE $1 ORDER BY created_at3 DESC",
        [`%${search.toLowerCase()}%`]
      );
    } else {
      articlesResult = await pool.query(
        "SELECT * FROM articles ORDER BY created_at3 DESC"
      );
    }

    const articles = articlesResult.rows;

    const totalResult = await pool.query("SELECT COUNT(*) FROM articles");
    const totalArticle = parseInt(totalResult.rows[0].count);

    res.render("admin/articles", {
      info,
      totalArticle,
      articles,
      search, // ✅ pass it to the view
      title: "Article",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
};
  
  
  // exports.showSingleArticle = async (req, res) => {
  //   const id = req.params.id;
  //   const result = await pool.query('SELECT * FROM articles WHERE id = $1', [id]);
  //   if (result.rows.length === 0) return res.status(404).send('Article not found');
  //   res.render('article', {
  //   article: result.rows[0],
  //   title: result.rows[0].title
  //   });
  // };
    
  exports.showSingleArticle = async (req, res) => {
    const articleId = req.params.id;
    // Fetch the main article
    const result = await pool.query("SELECT * FROM articles WHERE id = $1", [
      articleId,
    ]);
    if (result.rows.length === 0)
      return res.status(404).send("Article not found");
    const article = result.rows[0];

    // Fetch related articles by similar title words (excluding the current article)
    const keywords = article.title.split(" ").slice(0, 3); // Use first 3 words as keywords
    const relatedResult = await pool.query(
      `SELECT * FROM articles 
       WHERE id != $1 AND (
         title ILIKE $2 OR title ILIKE $3 OR title ILIKE $4
       )
       LIMIT 4`,
      [
        articleId,
        `%${keywords[0]}%`,
        `%${keywords[1] || ""}%`,
        `%${keywords[2] || ""}%`,
      ]
    );
    const relatedArticles = relatedResult.rows;
    const relatedIds = relatedArticles
      .map((a) => a.id)
      .concat([parseInt(articleId)]);
    const otherResult = await pool.query(
      `SELECT * FROM articles WHERE id NOT IN (${relatedIds
        .map((_, i) => `$${i + 1}`)
        .join(",")}) ORDER BY created_at3 DESC LIMIT 4`,
      relatedIds
    );
    const otherArticles = otherResult.rows;
  

        // Fetch likes for all articles
        const likesResult = await pool.query(`
      SELECT content_id, COUNT(*) as count
      FROM likes
      WHERE content_type = 'article'
      GROUP BY content_id
    `);
    
        const likeMap = {};
        likesResult.rows.forEach((row) => {
          likeMap[row.content_id] = parseInt(row.count);
        });
    
        const articles = result.rows;
        // Merge comment counts into articles
        articles.forEach((article) => {
          article.like_count = likeMap[article.id] || 0;
        });
    
        const articles2 = result.rows;
    
        // Fetch comment for all articles
        const commentResult = await pool.query(`
        SELECT content_id, COUNT(*) as count
        FROM comments
        WHERE content_type = 'article'
        GROUP BY content_id
      `);
    
        const commentMap = {};
        commentResult.rows.forEach((row) => {
          commentMap[row.content_id] = parseInt(row.count);
        });
    
        // Merge comment counts into articles
        articles2.forEach((article) => {
          article.comment_count = commentMap[article.id] || 0;
        });
    

    res.render("singleArticle", {
      article,
      relatedArticles,
      otherArticles,
      user: req.session.user || null,
      isLoggedIn: !!req.session.user,
    });
  };

