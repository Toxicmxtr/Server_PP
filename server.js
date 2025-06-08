const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ldap = require('ldapjs');
const cron = require('node-cron');

const app = express();
const port = 3000;

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Раздача статических файлов
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known')));

// Настройка CORS (для запросов с Flutter-приложения)
app.use(cors());
app.use(express.json());

// Настройка подключения к PostgreSQL
const pool = new Pool({
  user: '2024_psql_dd_usr',         // Имя пользователя базы данных
  host: '5.183.188.132',           // Хост базы данных
  database: '2024_psql_dani',       // Имя базы данных
  password: '4t6FjYUwkQV5eVJB',    // Пароль
  port: 5432,                      // Порт PostgreSQL
});

// CRON: Удаление старых постов
cron.schedule('0 0 * * *', async () => {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM posts
        WHERE post_date < CURRENT_DATE - INTERVAL '30 days'
      `);
      console.log(`[CRON] Удалено старых постов: ${result.rowCount}`);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[CRON] Ошибка при удалении старых постов:', error.message);
  }
});


// Убедитесь, что у вас настроен путь для доступа к загруженным файлам
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/posts', express.static(path.join(__dirname, 'posts')));

// Конфигурация multer
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath); // Создаём папку, если её нет
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'), false);
    }
  },
});

app.use('/.well-known', express.static(path.join(__dirname, '.well-known'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    }
  }
}));

// Настройка хранилища для multer
const postUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(__dirname, 'posts'); // Папка для хранения изображений
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true }); // Создаем папку, если её нет
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      // Уникальное имя для файла
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true); // Если файл подходящий по типу
    } else {
      cb(new Error('Unsupported file type'), false); // Ошибка для неподдерживаемых типов
    }
  },
});

// Корневой маршрут
app.get('/', (req, res) => {
  res.send('Сервер работает! Добро пожаловать!');
});

// Пример маршрута для получения данных из базы
app.get('/data', async (req, res) => {
  try {
    console.log('Выполняется запрос: SELECT * FROM users');
    const result = await pool.query('SELECT * FROM users');
    console.log('Результат запроса:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Ошибка при выполнении запроса:', err);
    res.status(500).send('Ошибка при получении данных');
  }
});

// Маршрут для регистрации пользователя
app.post('/register', async (req, res) => {
  console.log('Полученные данные:', req.body); // Отладка
  const { user_phone_number, user_password } = req.body;

  if (!user_phone_number || !user_password) {
    return res.status(400).send('Телефон и пароль обязательны');
  }

  try {
    // Проверяем, существует ли уже пользователь с указанным номером телефона
    const existingUser = await pool.query(
      'SELECT user_id FROM users WHERE user_phone_number = $1',
      [user_phone_number]
    );

    if (existingUser.rows.length > 0) {
      // Если пользователь с таким номером телефона существует, возвращаем ошибку
      return res.status(400).json({
        message: 'Такой номер телефона уже зарегистрирован',
      });
    }

    // Вставляем данные пользователя и получаем его ID
    const result = await pool.query(
      'INSERT INTO users (user_phone_number, user_password) VALUES ($1, $2) RETURNING user_id',
      [user_phone_number, user_password]
    );

    const userId = result.rows[0].user_id;

    // Формируем значения для user_acctag и user_name
    const userAcctag = `@user${userId}`;
    const userName = `Пользователь ${userId}`;

    // Обновляем запись пользователя с user_acctag и user_name
    await pool.query(
      'UPDATE users SET user_acctag = $1, user_name = $2 WHERE user_id = $3',
      [userAcctag, userName, userId]
    );

    // Возвращаем user_id в ответе
    res.status(201).json({
      message: 'Пользователь успешно зарегистрирован',
      user_id: userId, // Добавляем user_id в ответ
    });
  } catch (err) {
    console.error('Ошибка при регистрации пользователя:', err);
    res.status(500).send('Ошибка при регистрации');
  }
});

//регистрация LDAP
app.post("/registerLDAP", async (req, res) => {
  console.log("[Полученные данные]:", req.body);
  const { user_login, user_password, user_phone_number, user_email } = req.body;

  if (!user_login || !user_password || !user_phone_number || !user_email) {
    console.error("[Ошибка] Не все данные переданы!");
    return res.status(400).json({ message: "Логин, пароль, телефон и email обязательны" });
  }

  const client = ldap.createClient({ url: "ldap://retroispk.ru:389" });

  let responseSent = false;
  function sendResponse(status, message) {
    if (!responseSent) {
      responseSent = true;
      res.status(status).json(message);
    }
  }

  console.log("[LDAP] Попытка подключения к серверу...");
  client.bind(`uid=${user_login},ou=users,dc=example,dc=org`, user_password, (err) => {
    if (err) {
      console.error("[LDAP Ошибка] Неверный логин или пароль:", err);
      return sendResponse(400, { message: "Неверный логин или пароль" });
    }

    console.log("[LDAP] Аутентификация успешна.");
    registerUserInDB();
  });

  async function registerUserInDB() {
    try {
      console.log("[PostgreSQL] Проверка существующего номера телефона...");
      const existingUser = await pool.query(
        "SELECT user_id FROM users WHERE user_phone_number = $1",
        [String(user_phone_number)]
      );

      if (existingUser.rows.length > 0) {
        console.error("[PostgreSQL Ошибка] Такой номер телефона уже зарегистрирован.");
        return sendResponse(400, { message: "Такой номер телефона уже зарегистрирован" });
      }

      console.log("[PostgreSQL] Добавление нового пользователя...");
      const result = await pool.query(
        `INSERT INTO users (user_phone_number, user_password, user_acctag, user_email, "user_LDAP") 
         VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
        [String(user_phone_number), user_password, String(user_login), String(user_email), 1]
      );

      console.log("[PostgreSQL] Пользователь успешно добавлен:", result.rows[0]);

      sendResponse(201, {
        message: "Пользователь успешно зарегистрирован",
        user_id: result.rows[0].user_id,
      });
    } catch (dbErr) {
      console.error("[PostgreSQL Ошибка] Ошибка при добавлении пользователя:", dbErr);
      sendResponse(500, { message: "Ошибка при регистрации", error: dbErr.message });
    } finally {
      client.unbind((unbindErr) => {
        if (unbindErr) {
          console.error("[LDAP Ошибка] Ошибка при отключении:", unbindErr);
        } else {
          console.log("[LDAP] Клиент успешно отключён.");
        }
      });
    }
  }
});

// Маршрут для входа
app.post('/login', async (req, res) => {
  const { identifier, user_password } = req.body;

  if (!identifier || !user_password) {
    return res.status(400).json({ message: 'Логин и пароль обязательны' });
  }

  try {
    // Получаем данные пользователя по номеру телефона или user_acctag
    const result = await pool.query(
      'SELECT user_id, user_password FROM users WHERE user_phone_number = $1 OR user_acctag = $1',
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Неверные учетные данные' });
    }

    const user = result.rows[0];

    // Проверяем, совпадает ли введенный пароль с паролем в базе данных
    if (user.user_password !== user_password) {
      return res.status(400).json({ message: 'Неверные учетные данные' });
    }

    // Если все верно, возвращаем user_id
    res.status(200).json({ message: 'Успешный вход', user_id: user.user_id });

  } catch (err) {
    console.error('Ошибка при выполнении запроса:', err);
    res.status(500).json({ message: 'Ошибка при проверке данных' });
  }
});


// Маршрут для входа если пароль забыт
app.post('/forgot', async (req, res) => {
  const { identifier } = req.body; // Теперь только номер телефона или user_acctag

  if (!identifier) {
    return res.status(400).json({ message: 'Номер телефона или ID обязательны' });
  }

  try {
    // Получаем данные пользователя по номеру телефона или user_acctag
    const result = await pool.query(
      'SELECT user_id FROM users WHERE user_phone_number = $1 OR user_acctag = $1',
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Неверные учетные данные' });
    }

    const user = result.rows[0];

    // Если все верно, возвращаем user_id
    res.status(200).json({ message: 'Успешный вход', user_id: user.user_id });

  } catch (err) {
    console.error('Ошибка при выполнении запроса:', err);
    res.status(500).json({ message: 'Ошибка при проверке данных' });
  }
});

//вывод участников доски
app.get('/api/boards/:id/members', async (req, res) => {
  const boardId = parseInt(req.params.id);

  try {
    // Получаем список user_id из таблицы boards_members по board_id
    const membersResult = await pool.query(
      'SELECT user_id FROM boards_members WHERE board_id = $1',
      [boardId]
    );

    if (membersResult.rows.length === 0) {
      return res.json([]);
    }

    const userIds = membersResult.rows.map(row => row.user_id);

    const usersResult = await pool.query(
      'SELECT user_id, user_name, user_acctag, avatar_url FROM users WHERE user_id = ANY($1::int[])',
      [userIds]
    );

    res.json(usersResult.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

//выход из доски обычным пользователем
app.post('/leaveBoard', async (req, res) => {
  const { board_id, user_id } = req.body;

  if (!board_id || !user_id) {
    return res.status(400).json({ message: 'board_id и user_id обязательны' });
  }

  try {
    // Проверяем имя пользователя
    const userResult = await pool.query('SELECT user_name FROM users WHERE user_id = $1', [user_id]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    const userName = userResult.rows[0].user_name;

    // Удаляем пользователя из доски
    const result = await pool.query(
      'DELETE FROM boards_members WHERE board_id = $1 AND user_id = $2',
      [board_id, user_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Запись не найдена: пользователь не состоит в доске' });
    }

    // Добавляем запись в posts
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().split(' ')[0];
    const postText = `Пользователь "${userName}" покинул доску`;

    await pool.query(
      `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, postText, date, time, board_id]
    );

    res.status(200).json({ message: 'Пользователь покинул доску' });
  } catch (err) {
    console.error('Ошибка при выходе из доски:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});



// Исключение пользователя из доски
app.post('/kickUserFromBoard', async (req, res) => {
  const { board_id, user_id } = req.body;

  if (!board_id || !user_id) {
    return res.status(400).json({ message: 'board_id и user_id обязательны' });
  }

  try {
    const check = await pool.query(
      'SELECT * FROM boards_members WHERE board_id = $1 AND user_id = $2',
      [board_id, user_id]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: 'Пользователь не является участником этой доски' });
    }

    // Получаем имя пользователя для записи в posts
    const userResult = await pool.query(
      'SELECT user_name FROM users WHERE user_id = $1',
      [user_id]
    );

    const userName = userResult.rows.length > 0 ? userResult.rows[0].user_name : 'Неизвестный пользователь';

    // Удаляем пользователя из участников доски
    await pool.query(
      'DELETE FROM boards_members WHERE board_id = $1 AND user_id = $2',
      [board_id, user_id]
    );

    // Добавляем запись в posts
    const now = new Date();
    const postDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const postTime = now.toTimeString().split(' ')[0]; // HH:MM:SS

    await pool.query(
      `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, `Пользователь "${userName}" был исключен из доски`, postDate, postTime, board_id]
    );

    res.status(200).json({ message: 'Пользователь исключён из доски' });
  } catch (err) {
    console.error('Ошибка при исключении пользователя:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});



app.get('/home/:id', async (req, res) => {
  const userId = req.params.id; // Получаем ID из параметров запроса

  try {
    // Выполняем запрос к базе данных
    const result = await pool.query(
      'SELECT user_name, user_phone_number, avatar_url FROM users WHERE user_id = $1',
      [userId]
    );

    // Проверяем, что пользователь существует
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Получаем данные пользователя
    const user = result.rows[0];

    // Проверяем на наличие null и подставляем значения по умолчанию
    const userName = user.user_name || 'Неизвестный пользователь';
    const userPhoneNumber = user.user_phone_number || 'Не указан номер телефона';
    const userPhotoUrl = user.avatar_url

    // Отправляем данные пользователя
    res.status(200).json({
      user_name: userName,
      user_phone_number: userPhoneNumber,
      avatar_url: userPhotoUrl,
    });
  } catch (err) {
    // Логируем ошибку и отправляем сообщение об ошибке
    console.error('Ошибка получения данных пользователя:', err.message);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/profile/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      'SELECT user_name, user_phone_number, user_acctag, avatar_url FROM users WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const user = result.rows[0];

    const userName = user.user_name || 'Неизвестный пользователь';
    const userPhoneNumber = user.user_phone_number || 'Не указан номер телефона';
    const userAcctag = user.user_acctag || '@Неизвестный';
    const avatarUrl = user.avatar_url || null; // Если аватар отсутствует, то null

    // Просто возвращаем имя файла аватара, а полный путь строится на клиенте
    res.status(200).json({
      user_name: userName,
      user_phone_number: userPhoneNumber,
      user_acctag: userAcctag,
      avatar_url: avatarUrl, // Возвращаем только имя файла
    });
  } catch (err) {
    console.error('Ошибка получения данных пользователя:', err.message);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Маршрут для получения данных пользователя
app.get('/settings/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('Пользователь не найден');
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Ошибка при получении данных пользователя:', err);
    res.status(500).send('Ошибка при получении данных');
  }
});

// Маршрут для обновления данных пользователя
app.patch('/settings/:id', async (req, res) => {
  const userId = req.params.id;
  const { user_name, user_phone_number, user_acctag } = req.body;

  try {
    // Проверяем, существует ли пользователь
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Проверка уникальности тега аккаунта
    if (user_acctag) {
      const acctagCheck = await pool.query(
        'SELECT * FROM users WHERE user_acctag = $1 AND user_id != $2',
        [user_acctag, userId]
      );
      if (acctagCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Тег уже существует, укажите другой' });
      }
    }

    // Проверка уникальности номера телефона
    if (user_phone_number) {
      const phoneCheck = await pool.query(
        'SELECT * FROM users WHERE user_phone_number = $1 AND user_id != $2',
        [user_phone_number, userId]
      );
      if (phoneCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Номер телефона уже используется, укажите другой' });
      }
    }

    // Обновляем данные в базе данных
    let updatedValues = [];
    let updateQuery = 'UPDATE users SET';

    if (user_name) {
      updatedValues.push(user_name);
      updateQuery += ' user_name = $' + updatedValues.length;
    }

    if (user_acctag) {
      if (updatedValues.length > 0) updateQuery += ',';
      updatedValues.push(user_acctag);
      updateQuery += ' user_acctag = $' + updatedValues.length;
    }

    if (user_phone_number) {
      if (updatedValues.length > 0) updateQuery += ',';
      updatedValues.push(user_phone_number);
      updateQuery += ' user_phone_number = $' + updatedValues.length;
    }

    updateQuery += ' WHERE user_id = $' + (updatedValues.length + 1);

    // Выполняем обновление с параметрами
    updatedValues.push(userId);
    await pool.query(updateQuery, updatedValues);

    res.status(200).json({ message: 'Данные пользователя успешно обновлены' });
  } catch (err) {
    console.error('Ошибка при обновлении данных пользователя:', err.message);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Маршрут для удаления пользователя
app.delete('/settings/:id', async (req, res) => {
  const userId = req.params.id;

  try {
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE user_id = $1',
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    // Удаляем пользователя
    await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);

    res.status(200).json({ message: 'Пользователь и связанные данные успешно удалены' });
  } catch (err) {
    console.error('Ошибка при удалении пользователя:', err.message);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

//получение постов
app.get('/posts', async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) {
      return res.status(400).json({ message: 'user_id обязателен' });
    }

    const posts = await pool.query(
      `SELECT 
         posts.post_id, posts.post_text, posts.post_date, posts.post_time, posts.post_views, posts.board_id,
         boards.board_name, colours.colour_name,
         users.user_name, users.user_acctag, users.avatar_url
       FROM posts
       JOIN users ON posts.post_user_id = users.user_id
       JOIN boards ON posts.board_id = boards.board_id
       JOIN colours ON boards.colour_id = colours.colour_id
       JOIN boards_members ON posts.board_id = boards_members.board_id
       WHERE boards_members.user_id = $1
       ORDER BY posts.post_date DESC, posts.post_time DESC`,
      [userId]
    );

    if (posts.rows.length > 0) {
      const formattedPosts = posts.rows.map(post => ({
        post_id: post.post_id,
        post_text: post.post_text,
        post_date: post.post_date,
        post_time: post.post_time,
        post_views: post.post_views,
        user_name: post.user_name || 'Неизвестный пользователь',
        user_acctag: post.user_acctag || '@Неизвестный',
        avatar_url: post.avatar_url || null,
        board_name: post.board_name,
        board_colour: post.colour_name,
      }));

      res.status(200).json(formattedPosts);
    } else {
      res.status(404).json({ message: 'Посты не найдены' });
    }
  } catch (err) {
    console.error('Ошибка при получении постов:', err.message);
    res.status(500).json({ message: 'Ошибка на сервере' });
  }
});

// Маршрут для получения досок пользователя
app.get('/boards/user/:user_id', async (req, res) => {
  const userId = parseInt(req.params.user_id);

  try {
    const result = await pool.query(
      `SELECT b.board_id, b.board_name, c.colour_name
       FROM boards b
       JOIN boards_members bm ON b.board_id = bm.board_id
       JOIN colours c ON b.colour_id = c.colour_id
       WHERE bm.user_id = $1`,
      [userId]
    );

    if (result.rows.length > 0) {
      const formattedBoards = result.rows.map(board => ({
        board_id: board.board_id,
        board_name: board.board_name,
        board_colour: board.colour_name,
      }));

      res.status(200).json(formattedBoards);
    } else {
      res.status(404).json({ message: 'Доски не найдены для этого пользователя' });
    }
  } catch (err) {
    console.error('Ошибка при получении досок пользователя:', err.message);
    res.status(500).json({ message: 'Ошибка на сервере' });
  }
});

// Маршрут для добавления новой колонки к существующей доске
app.post('/boards/:boardId/columns', async (req, res) => {
  const { column_name, column_colour, user_id } = req.body; // column_colour = colour_id
  const { boardId } = req.params;

  if (!column_name || !column_colour) {
    return res.status(400).json({ message: 'Название колонки и column_colour обязательны' });
  }

  try {
    // Проверяем, существует ли доска
    const boardCheck = await pool.query('SELECT board_id FROM boards WHERE board_id = $1', [boardId]);
    if (boardCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Вставляем новую колонку с column_colour (colour_id)
    const columnResult = await pool.query(
      `INSERT INTO columns (column_name, colour_id, board_id) 
       VALUES ($1, $2, $3) RETURNING column_id`,
      [column_name, column_colour, boardId]
    );

    const columnId = columnResult.rows[0].column_id;
    console.log(`Создана новая колонка с ID: ${columnId} для доски ${boardId}`);

    const postText = `Добавлена колонка "${column_name}"`;
    const now = new Date();
    const postDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const postTime = now.toTimeString().split(' ')[0]; // HH:MM:SS

    await pool.query(
      `INSERT INTO posts (post_text, post_user_id, post_date, post_time, board_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [postText, user_id, postDate, postTime, boardId]
    );

    res.status(201).json({ message: 'Колонка успешно добавлена', column_id: columnId });
  } catch (err) {
    console.error('Ошибка при добавлении колонки:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

//удаление колонки из доски
app.delete('/boards/:boardId/columns/:columnId', async (req, res) => {
  const { boardId, columnId } = req.params;
  const { user_id } = req.body;

  try {
    // Проверяем, существует ли доска
    const boardCheck = await pool.query('SELECT board_id FROM boards WHERE board_id = $1', [boardId]);
    if (boardCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Проверяем, существует ли колонка и принадлежит ли она доске
    const columnCheck = await pool.query(
      'SELECT column_name, board_id FROM columns WHERE column_id = $1',
      [columnId]
    );
    if (columnCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Колонка не найдена' });
    }

    if (columnCheck.rows[0].board_id.toString() !== boardId) {
      return res.status(400).json({ message: 'Колонка не принадлежит доске' });
    }

    const columnName = columnCheck.rows[0].column_name;

    // Удаляем колонку
    await pool.query('DELETE FROM columns WHERE column_id = $1', [columnId]);

    console.log(`Колонка "${columnName}" с ID ${columnId} удалена из доски ${boardId}`);

    // ⬇ Добавляем запись в posts
    if (user_id && !isNaN(parseInt(user_id))) {
      const now = new Date();
      const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const time = now.toTimeString().split(' ')[0]; // HH:MM:SS

      await pool.query(
        `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user_id,
          `Удалена колонка "${columnName}"`,
          date,
          time,
          boardId
        ]
      );
    }

    res.status(200).json({ message: 'Колонка успешно удалена' });
  } catch (err) {
    console.error('Ошибка при удалении колонки:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

//маршрут для изменения названия колонки
app.put('/boards/:boardId/columns/:columnId', async (req, res) => {
  const { boardId, columnId } = req.params;
  const { newName, user_id } = req.body;

  try {
    if (!user_id) {
      return res.status(400).json({ message: 'user_id обязателен' });
    }

    // Проверка существования доски
    const boardCheck = await pool.query(
      'SELECT board_id FROM boards WHERE board_id = $1',
      [boardId]
    );
    if (boardCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Проверка существования колонки и принадлежности доске
    const columnCheck = await pool.query(
      'SELECT column_name, board_id FROM columns WHERE column_id = $1',
      [columnId]
    );
    if (columnCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Колонка не найдена' });
    }

    if (columnCheck.rows[0].board_id.toString() !== boardId) {
      return res.status(400).json({ message: 'Колонка не принадлежит доске' });
    }

    if (!newName || typeof newName !== 'string' || newName.trim() === '') {
      return res.status(400).json({ message: 'Некорректное имя колонки' });
    }

    const oldName = columnCheck.rows[0].column_name;

    // Обновление названия
    await pool.query(
      'UPDATE columns SET column_name = $1 WHERE column_id = $2',
      [newName, columnId]
    );

    // Запись в posts
    const now = new Date();
    const postDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const postTime = now.toTimeString().split(' ')[0]; // HH:MM:SS

    const postText = `Изменено название колонки с "${oldName}" на "${newName}"`;

    await pool.query(
      `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, postText, postDate, postTime, boardId]
    );

    console.log(`Колонка с ID ${columnId} обновлена на "${newName}"`);
    res.status(200).json({ message: 'Колонка успешно обновлена' });
  } catch (err) {
    console.error('Ошибка при редактировании колонки:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Маршрут для удаления одной записи из колонки
app.delete('/boards/:boardId/columns/:columnId/delete', async (req, res) => {
  const { boardId, columnId } = req.params;
  const { textToDelete } = req.body;

  try {
    if (!textToDelete) {
      return res.status(400).json({ error: 'Text to delete is required' });
    }

    // Удаляем только одну запись с подходящим column_id и record_text
    const deleteResult = await pool.query(
      `DELETE FROM records
       WHERE record_id = (
         SELECT record_id FROM records
         WHERE column_id = $1 AND record_text = $2
         LIMIT 1
       )
       RETURNING *`,
      [columnId, textToDelete]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.status(200).json({ success: 'Record deleted successfully' });
  } catch (err) {
    console.error('Error deleting record from column:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/boards', async (req, res) => {
  const { board_name, board_colour, board_users } = req.body;

  if (!board_name || !board_colour || !board_users || board_users.length === 0) {
    return res.status(400).json({ message: 'Все поля обязательны, включая хотя бы одного пользователя' });
  }

  try {
    const creatorId = parseInt(board_users[0]);

    // Получаем colour_id из colours по имени цвета доски
    const colourResult = await pool.query(
      'SELECT colour_id FROM colours WHERE colour_name = $1',
      [board_colour]
    );

    if (colourResult.rows.length === 0) {
      return res.status(400).json({ message: 'Указанный цвет доски не существует' });
    }

    const colourId = colourResult.rows[0].colour_id;

    // Вставляем доску с colour_id
    const insertBoardQuery = `
      INSERT INTO boards (board_name, colour_id, user_id) 
      VALUES ($1, $2, $3) RETURNING board_id
    `;
    const boardResult = await pool.query(insertBoardQuery, [board_name, colourId, creatorId]);
    const boardId = boardResult.rows[0].board_id;
    console.log(`Создана доска с ID: ${boardId}, создатель: ${creatorId}`);

    // Добавляем создателя в участники доски
    await pool.query(
      'INSERT INTO boards_members (board_id, user_id) VALUES ($1, $2)',
      [boardId, creatorId]
    );
    console.log(`Пользователь ${creatorId} добавлен в участники доски ${boardId}`);

    // Колонки по умолчанию с цветами в виде имён
    const columns = [
      { column_name: 'Факты', column_colour: 'white' },
      { column_name: 'Эмоции', column_colour: 'red' },
      { column_name: 'Преимущества', column_colour: 'yellow' },
      { column_name: 'Критика', column_colour: 'black' },
      { column_name: 'Решение', column_colour: 'green' },
      { column_name: 'Контроль', column_colour: 'blue' },
    ];

    for (let column of columns) {
      // Получаем colour_id по имени цвета колонки
      const colColourResult = await pool.query(
        'SELECT colour_id FROM colours WHERE colour_name = $1',
        [column.column_colour]
      );

      if (colColourResult.rows.length === 0) {
        console.warn(`Цвет колонки "${column.column_colour}" не найден, пропускаем эту колонку`);
        continue; // если цвет не найден, пропускаем вставку этой колонки
      }

      const colColourId = colColourResult.rows[0].colour_id;

      
      await pool.query(
        `INSERT INTO columns (column_name, colour_id, board_id)
         VALUES ($1, $2, $3)`,
        [column.column_name, colColourId, boardId]
      );

      console.log(`Создана колонка "${column.column_name}" с цветом ID ${colColourId} для доски ${boardId}`);
    }

    res.status(201).json({ message: 'Доска и колонки успешно созданы', board_id: boardId });
  } catch (err) {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/boards/:boardId', async (req, res) => {
  const { boardId } = req.params;

  try {
    // Получаем colour_id и user_id доски
    const boardResult = await pool.query(
      'SELECT colour_id, user_id FROM boards WHERE board_id = $1',
      [boardId]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const board = boardResult.rows[0];

    // Получаем colour_name доски по colour_id
    const colourResult = await pool.query(
      'SELECT colour_name FROM colours WHERE colour_id = $1',
      [board.colour_id]
    );

    const board_colour = colourResult.rows.length > 0 ? colourResult.rows[0].colour_name : null;

    // Получаем колонки доски с colour_id
    const columnsResult = await pool.query(
      `SELECT column_id, column_name, colour_id
       FROM columns
       WHERE board_id = $1
       ORDER BY column_id`,
      [boardId]
    );

    const columnsRaw = columnsResult.rows;

    // Получаем для всех колонок их цветовые имена из colours
    // Собираем уникальные colour_id из колонок
    const uniqueColourIds = [...new Set(columnsRaw.map(col => col.colour_id))];
    let coloursMap = {};

    if (uniqueColourIds.length > 0) {
      const coloursResult = await pool.query(
        `SELECT colour_id, colour_name FROM colours WHERE colour_id = ANY($1)`,
        [uniqueColourIds]
      );

      coloursMap = coloursResult.rows.reduce((acc, cur) => {
        acc[cur.colour_id] = cur.colour_name;
        return acc;
      }, {});
    }

    // Добавляем к колонкам поле colour_name вместо colour_id
    const columns = columnsRaw.map(col => ({
      column_id: col.column_id,
      column_name: col.column_name,
      column_colour: coloursMap[col.colour_id] || null,
    }));

    // Получаем все записи для колонок этой доски
    const recordsResult = await pool.query(
      `SELECT column_id, record_text 
       FROM records 
       WHERE column_id IN (
         SELECT column_id FROM columns WHERE board_id = $1
       )
       ORDER BY record_id`,
      [boardId]
    );

    // Группируем записи по column_id
    const recordsByColumn = {};
    for (const row of recordsResult.rows) {
      if (!recordsByColumn[row.column_id]) {
        recordsByColumn[row.column_id] = [];
      }
      recordsByColumn[row.column_id].push(row.record_text);
    }

    // Добавляем записи к колонкам
    const columnsWithRecords = columns.map(col => ({
      ...col,
      records: recordsByColumn[col.column_id] || [],
    }));

    res.json({
      board_colour,
      board_creator: board.user_id,
      columns: columnsWithRecords,
    });
  } catch (err) {
    console.error('Error fetching board data:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});



// Удаление доски, связанных колонок и записей
app.delete('/boards/:boardId/delete', async (req, res) => {
  const { boardId } = req.params;

  try {
    // Проверяем, что доска существует
    const boardResult = await pool.query(
      'SELECT board_id FROM boards WHERE board_id = $1',
      [boardId]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // Удаляем записи из records, связанные с колонками этой доски
    await pool.query(
      `DELETE FROM records 
       WHERE column_id IN (SELECT column_id FROM columns WHERE board_id = $1)`,
      [boardId]
    );

    // Удаляем колонки доски
    await pool.query('DELETE FROM columns WHERE board_id = $1', [boardId]);

    // Удаляем доску
    await pool.query('DELETE FROM boards WHERE board_id = $1', [boardId]);

    res.status(200).json({ message: 'Board, related columns and records deleted successfully' });
  } catch (error) {
    console.error('Error deleting board, columns, and records:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Приглашение пользователя в доску
app.post('/boards/:boardId/invite', async (req, res) => {
  const { boardId } = req.params;
  const { user_acctag, user_id } = req.body;

  try {
    const boardResult = await pool.query('SELECT * FROM boards WHERE board_id = $1', [boardId]);

    if (boardResult.rowCount === 0) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    const board = boardResult.rows[0];

    if (board.user_id !== user_id) {
      return res.status(403).json({ message: 'Вы не являетесь создателем этой доски' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE user_acctag = $1', [user_acctag]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }

    const invitedUser = userResult.rows[0];
    const invitedUserId = invitedUser.user_id;

    const checkResult = await pool.query(
      'SELECT * FROM boards_members WHERE board_id = $1 AND user_id = $2',
      [boardId, invitedUserId]
    );

    if (checkResult.rowCount > 0) {
      return res.status(400).json({ message: 'Пользователь уже добавлен' });
    }

    await pool.query(
      'INSERT INTO boards_members (board_id, user_id) VALUES ($1, $2)',
      [boardId, invitedUserId]
    );

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().split(' ')[0];
    const postText = `Пользователь "${invitedUser.user_name}" присоединился к доске`;

    await pool.query(
      `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [invitedUserId, postText, date, time, boardId]
    );

    return res.status(200).json({ message: 'Пользователь успешно приглашен' });
  } catch (error) {
    console.error('Ошибка при приглашении пользователя:', error);
    res.status(500).json({ message: 'Ошибка при приглашении пользователя' });
  }
});


// Обновленный маршрут для генерации ссылки-приглашения
app.post('/boards/:boardId/invite-link', async (req, res) => {
  const { boardId } = req.params;
  const { inviterId } = req.body;

  try {
    const token = crypto.randomBytes(16).toString('hex');
    const status = 'pending';

    const result = await pool.query(
      'INSERT INTO invites (board_id, inviter_id, token, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING token',
      [boardId, inviterId, token, status]
    );

    const inviteToken = result.rows[0].token;

    const inviteLink = `https://retroispk.ru/invite/${inviteToken}`;

    res.json({ inviteLink });
  } catch (err) {
    console.error('Error creating invite:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Проверка ссылки-приглашения
app.get('/invite/:token', async (req, res) => {
  const { token } = req.params;

  try {
      const result = await pool.query(
          'SELECT * FROM invites WHERE token = $1',
          [token]
      );

      if (result.rows.length === 0) {
          console.log(`Invite not found: ${token}`);
          return res.status(404).send('Invite not found or expired');
      }

      const androidIntentLink = `intent://invite/${token}#Intent;scheme=https;package=retroispk.app;end;`;
      const iosLink = `https://retroispk.ru/invite/${token}`;

      const userAgent = req.get('User-Agent');
      console.log(`Processing invite request for token: ${token} (User-Agent: ${userAgent})`);

      res.send(`
          <!DOCTYPE html>
          <html lang="ru">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Открытие приложения...</title>
          </head>
          <body>
              <p>Если приложение не открылось автоматически, <a href="${androidIntentLink}">нажмите здесь</a>.</p>

              <script>
                  setTimeout(function() {
                      window.location.href = "${androidIntentLink}";
                  }, 100);
                  setTimeout(function() {
                      window.location.href = "https://retroispk.ru";
                  }, 2000);
              </script>
          </body>
          </html>
      `);
  } catch (err) {
      console.error('Error fetching invite:', err);
      res.status(500).send('Internal Server Error');
  }
});


// Обработка favicon.ico, чтобы браузер не слетал на корневой маршрут
app.get('/favicon.ico', (req, res) => res.status(204));

app.post('/invite/:token/respond', async (req, res) => {
  const { token } = req.params;
  const { userId, response } = req.body; // response: 'accepted' или 'declined'

  try {
    const inviteResult = await pool.query(
      'SELECT * FROM invites WHERE token = $1',
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found or expired' });
    }

    const boardId = inviteResult.rows[0].board_id;

    if (response === 'accepted') {
      // Проверка: уже добавлен?
      const checkMember = await pool.query(
        'SELECT * FROM boards_members WHERE board_id = $1 AND user_id = $2',
        [boardId, userId]
      );

      if (checkMember.rowCount === 0) {
        // Добавляем в boards_members
        await pool.query(
          'INSERT INTO boards_members (board_id, user_id) VALUES ($1, $2)',
          [boardId, userId]
        );
      }

      // Получаем имя пользователя для записи в posts
      const userResult = await pool.query(
        'SELECT user_name FROM users WHERE user_id = $1',
        [userId]
      );

      const userName = userResult.rows.length > 0 ? userResult.rows[0].user_name : 'Неизвестный пользователь';

      // Добавляем запись в posts
      const now = new Date();
      const postDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const postTime = now.toTimeString().split(' ')[0]; // HH:MM:SS

      await pool.query(
        `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, `Пользователь "${userName}" присоединился к доске по ссылке-приглашению`, postDate, postTime, boardId]
      );
    }

    // Обновляем статус приглашения
    await pool.query(
      'UPDATE invites SET status = $1 WHERE token = $2',
      [response, token]
    );

    res.json({ message: `Invite ${response}` });
  } catch (err) {
    console.error('Error responding to invite:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//отображение названия доски
app.get('/invite/:token/board-name', async (req, res) => {
  const { token } = req.params;

  try {
    const inviteResult = await pool.query(
      'SELECT board_id FROM invites WHERE token = $1',
      [token]
    );

    if (inviteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found or expired' });
    }

    const boardId = inviteResult.rows[0].board_id;

    const boardResult = await pool.query(
      'SELECT board_name FROM boards WHERE board_id = $1',
      [boardId]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    res.json({ boardName: boardResult.rows[0].board_name });
  } catch (err) {
    console.error('Error fetching board name:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Серверный код для добавления записи в колонку с user_id
app.post('/boards/:boardId/columns/:columnId/add', async (req, res) => {
  const { boardId, columnId } = req.params;
  const { newText, userId } = req.body;

  try {
    if (!newText || newText.trim().length === 0) {
      return res.status(400).json({ error: 'Text cannot be empty' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Получаем название колонки и проверяем, что она существует в этой доске
    const columnResult = await pool.query(
      'SELECT column_name FROM columns WHERE column_id = $1 AND board_id = $2',
      [columnId, boardId]
    );

    if (columnResult.rows.length === 0) {
      return res.status(404).json({ error: 'Column not found' });
    }

    const columnName = columnResult.rows[0].column_name;

    // Добавляем запись в records
    await pool.query(
      'INSERT INTO records (column_id, record_text, user_id) VALUES ($1, $2, $3)',
      [columnId, newText, userId]
    );

    // Получаем дату и время
    const now = new Date();
    const postDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const postTime = now.toTimeString().split(' ')[0]; // HH:MM:SS

    // Формируем текст поста с названием колонки
    const postText = `Добавлена запись "${newText}" в колонку "${columnName}"`;

    // Вставляем запись в posts
    await pool.query(
      `INSERT INTO posts (post_user_id, post_text, post_date, post_time, board_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, postText, postDate, postTime, boardId]
    );

    res.status(200).json({ success: 'Text added successfully' });
  } catch (err) {
    console.error('Error adding text to column:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Маршрут для увеличения просмотров поста
app.patch('/posts/:id/views', async (req, res) => {
  const postId = req.params.id;

  try {
    // Увеличиваем количество просмотров поста
    const result = await pool.query(
      `UPDATE posts 
       SET post_views = post_views + 1 
       WHERE post_id = $1 
       RETURNING post_views`,
      [postId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Пост не найден' });
    }

    res.status(200).json({ message: 'Просмотры обновлены', post_views: result.rows[0].post_views });
  } catch (err) {
    console.error('Ошибка при увеличении просмотров поста:', err.message);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Маршрут для загрузки аватарки пользователя
app.post('/upload-avatar/:id', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('File not uploaded');
    }
    const avatarPath = `/uploads/${req.file.filename}`;
    const result = await pool.query(
      'UPDATE users SET avatar_url = $1 WHERE user_id = $2 RETURNING *',
      [avatarPath, req.params.id]
    );
    if (result.rowCount === 0) {
      throw new Error(`User with ID ${req.params.id} not found`);
    }
    res.status(200).json({ message: 'Avatar updated', avatar_url: avatarPath });
  } catch (err) {
    console.error('Error uploading avatar:', err);
    res.status(500).json({ message: err.message });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер работает на https://retroispk.ru:${port}`);
});