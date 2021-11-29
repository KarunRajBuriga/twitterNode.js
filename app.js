const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3001, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    const selectUserQuery = `
        SELECT *
        FROM user 
        WHERE username = '${username}';
        `;
    const dbUser = await database.get(selectUserQuery);
    if (dbUser === undefined) {
      const createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        )`;
      const dbResponse = await database.run(createUserQuery);
      const newUserId = dbResponse.lastID;
      response.send(`User created successfully`);
    } else {
      response.status(400);
      response.send("User already exists");
    }
  }
});

//API 2 LOGIN

app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser === undefined) {
    console.log(dbUser);
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// middle wear function

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

// API 3 GET
app.get("/user/tweets/feed", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = `
  SELECT user_id
  from user
  where username ='${username}';`;
  const id = await database.get(userId);
  const requiredID = id.user_id;

  const followingQuery = `
  
  SELECT user.username as username,
  tweet.tweet as tweet,
  tweet.date_time as dateTime
  FROM (follower INNER JOIN user ON follower.following_user_id = user.user_id) as T 
  INNER JOIN tweet on tweet.user_id =  T.user_id
  WHERE follower.follower_user_id = '${requiredID}'
  ORDER by tweet.date_time DESC
  LIMIT 4 ;
  `;
  const followingArray = await database.all(followingQuery);
  response.send(followingArray);
});

//API 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = `
  SELECT user_id
  from user
  where username ='${username}';`;
  const id = await database.get(userId);
  const requiredID = id.user_id;
  //console.log(requiredID);//
  const followingQuery = `
  SELECT user.name as name
  FROM follower INNER JOIN user ON follower.following_user_id = user.user_id
  WHERE follower.follower_user_id = '${requiredID}';
  `;
  const followingArray = await database.all(followingQuery);
  response.send(followingArray);
});

// API 5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;
  const userId = `
  SELECT user_id
  from user
  where username ='${username}';`;
  const id = await database.get(userId);
  const requiredID = id.user_id;
  console.log(requiredID);
  const followersQuery = `
  SELECT user.name as name
  FROM follower INNER JOIN user ON follower.follower_user_id = user.user_id
  WHERE following_user_id = '${requiredID}';
  `;
  const followersArray = await database.all(followersQuery);
  response.send(followersArray);
});

//middlewear//

const tweetIdVerify = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const userIdQuery = `
  SELECT user_id
  FROM user
  WHERE username = '${username}';`;
  const dbResponse = await database.get(userIdQuery);
  const userId = dbResponse.user_id;
  const verifyQuery = `
  SELECT tweet.tweet_id
  FROM follower inner join tweet on follower.following_user_id = tweet.user_id
  WHERE follower_user_id  = '${userId}' AND tweet.tweet_id = '${tweetId}';`;
  const verify = await database.all(verifyQuery);
  if (verify.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// API 6

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetIdVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const tweetQuery = `

      SELECT tweet.tweet as tweet,
      COUNT(DISTINCT (like.like_id)) as likes,
      COUNT(DISTINCT (reply.reply_id)) as replies,
      tweet.date_time as dateTime

      FROM (like join reply on like.tweet_id = reply.tweet_id )as T
      join tweet on T.tweet_id = tweet.tweet_id
      WHERE tweet.tweet_id = '${tweetId}'
      ;
      `;
    const tweetDetails = await database.get(tweetQuery);
    response.send(tweetDetails);
  }
);

//API 7

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetIdVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const likedUserQuery = `
    SELECT user.username
    FROM user left join like
    on like.user_id = user.user_id
    Where like.tweet_id = '${tweetId}';`;
    const likedUsersDetails = await database.all(likedUserQuery);
    const likes = [];
    likedUsersDetails.map((each) => {
      likes.push(each);
    });
    const userLikes = {};
    userLikes["likes"] = likes;
    response.send(userLikes);
  }
);
//API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetIdVerify,
  async (request, response) => {
    const { tweetId } = request.params;
    const replyUserQuery = `
    SELECT user.name as name,
    reply.reply as reply
    FROM user left join reply
    on reply.user_id = user.user_id
    Where reply.tweet_id = '${tweetId}' ;`;
    const replyUsersDetails = await database.all(replyUserQuery);
    const replies = [];
    replyUsersDetails.map((eachReply) => {
      replies.push(eachReply);
    });
    const userReplies = {};
    userReplies["replies"] = replies;
    response.send(userReplies);
  }
);
//API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getUserId = `
  SELECT user_id
  FROM user
  where username = '${username}';`;
  const userID = await database.get(getUserId);
  const id = userID.user_id;
  const tweetQuery = `
    SELECT tweet.tweet AS tweet,
    COUNT(DISTINCT(like.like_id)) AS likes,
    COUNT(DISTINCT(reply.reply_id)) AS replies,
    tweet.date_time AS dateTime
    from tweet join like on tweet.tweet_id = like.tweet_id
    join reply on tweet.tweet_id = reply.tweet_id

    WHERE tweet.user_id = '${id}'
    group by tweet.tweet_id;
    `;
  const tweetArray = await database.all(tweetQuery);
  response.send(tweetArray);
});
// API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  createTweetQuery = `
  INSERT INTO tweet(tweet)
  VALUES(
      '${tweet}'
  )
  `;
  const dbResponse = await database.run(createTweetQuery);
  response.send("Created a Tweet");
});

//API 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const verifyQuery = `
      SELECT tweet.tweet_id
      from user left join tweet
      on user.user_id = tweet.user_id
      WHERE user.username='${username}' AND tweet.tweet_id = '${tweetId}';`;
    const verifiesArray = await database.get(verifyQuery);
    if (verifiesArray === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
        DELETE FROM tweet
        where tweet_id = '${tweetId}';`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
