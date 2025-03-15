const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = 3000;


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

// Маршрут для входа
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


// Роут для загрузки изображения
app.post('/upload-post-picture', postUpload.single('post_picture'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Файл не загружен' });
    }
    const picturePath = `${req.file.filename}`; // Путь к изображению
    res.status(200).json({
      message: 'Фотография поста успешно загружена',
      picture_url: picturePath, // URL изображения для использования в посте
    });
  } catch (err) {
    console.error('Ошибка при загрузке фотографии поста:', err);
    res.status(500).json({ message: 'Ошибка при загрузке фотографии' });
  }
});

app.post('/add_posts', async (req, res) => {
  console.log('Полученные данные:', req.body);
  const { post_text, user_id, post_picture, post_date, post_time } = req.body;

  // Проверяем наличие текста поста и идентификатора пользователя
  if (!post_text || post_text.trim().length === 0) {
    return res.status(400).json({ message: 'Текст поста не может быть пустым' });
  }
  if (!user_id) {
    return res.status(400).json({ message: 'Идентификатор пользователя обязателен' });
  }

  let currentDate = post_date || new Date().toISOString().split('T')[0];
  let currentTime = post_time || new Date().toISOString().split('T')[1].split('.')[0];

  // Проверка на корректность даты и времени
  if (!isValidDate(currentDate)) {
    return res.status(400).json({ message: 'Некорректный формат даты' });
  }
  if (!isValidTime(currentTime)) {
    return res.status(400).json({ message: 'Некорректный формат времени' });
  }

  // Если изображение было загружено, сохраняем путь к файлу
  const postPictureUrl = post_picture || null; // Используем URL, полученный от загрузки

  try {
    const result = await pool.query(
      `INSERT INTO posts (post_user_id, post_text, post_picture, post_date, post_views, post_time)
       VALUES ($1, $2, $3, $4, 0, $5)
       RETURNING post_id, post_user_id, post_text, post_picture, post_date, post_views, post_time`,
      [user_id, post_text, postPictureUrl, currentDate, currentTime]
    );

    console.log('Добавлен новый пост:', result.rows[0]);
    res.status(201).json(result.rows[0]); // Отправляем ответ с добавленным постом
  } catch (err) {
    console.error('Ошибка при создании поста:', err);
    res.status(500).json({ message: 'Ошибка на сервере' });
  }
});

// Функция для проверки корректности формата даты (YYYY-MM-DD)
function isValidDate(date) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(date);
}

// Функция для проверки корректности формата времени (HH:mm:ss)
function isValidTime(time) {
  const regex = /^([01]?[0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$/;
  return regex.test(time);
}

// Обновленный роут для получения всех постов с фотографиями
app.get('/posts', async (req, res) => {
  try {
    const posts = await pool.query(
      `SELECT 
         posts.post_id, 
         posts.post_text, 
         posts.post_date, 
         posts.post_time, 
         posts.post_views, 
         posts.post_picture,
         users.user_name, 
         users.user_acctag, 
         users.avatar_url
       FROM posts
       JOIN users ON posts.post_user_id = users.user_id
       ORDER BY posts.post_date DESC, posts.post_time DESC`
    );

    if (posts.rows.length > 0) {
      const formattedPosts = posts.rows.map(post => ({
        post_id: post.post_id,
        post_text: post.post_text,
        post_date: post.post_date,
        post_time: post.post_time,
        post_views: post.post_views,
        post_picture: post.post_picture ? `http://localhost:3000/posts/${post.post_picture}` : null,
        user_name: post.user_name || 'Неизвестный пользователь',
        user_acctag: post.user_acctag || '@Неизвестный',
        avatar_url: post.avatar_url || null,
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
  const userId = req.params.user_id; // Получаем user_id из параметров запроса

  try {
    // Выполняем запрос к базе данных для получения досок пользователя
    const result = await pool.query(
      `SELECT 
         boards.board_id, 
         boards.board_name, 
         boards.board_colour
       FROM boards
       WHERE board_users LIKE '%${userId}%'`, // Используем LIKE для поиска userId в строке
    );

    // Проверяем, есть ли доски для этого пользователя
    if (result.rows.length > 0) {
      const formattedBoards = result.rows.map(board => ({
        board_id: board.board_id,
        board_name: board.board_name,
        board_colour: board.board_colour,
      }));

      // Возвращаем доски
      res.status(200).json(formattedBoards);
    } else {
      res.status(404).json({ message: 'Доски не найдены для этого пользователя' });
    }
  } catch (err) {
    console.error('Ошибка при получении досок пользователя:', err.message);
    res.status(500).json({ message: 'Ошибка на сервере' });
  }
});

// Маршрут для заноса данных о созданной доске
app.post('/boards', async (req, res) => {
  const { board_name, board_colour, board_users } = req.body;

  if (!board_name || !board_colour || !board_users) {
    return res.status(400).json({ message: 'Все поля обязательны' });
  }

  try {
    // Вставляем новую доску с указанием создателя
    const insertBoardQuery = `
      INSERT INTO boards (board_name, board_colour, board_users, board_creator) 
      VALUES ($1, $2, $3, $4) RETURNING board_id
    `;
    // Преобразуем board_users[0] в формат {"7"} (или другое число пользователя)
    const boardCreator = `{"${board_users[0]}"}`;
    const boardResult = await pool.query(insertBoardQuery, [board_name, board_colour, board_users, boardCreator]);

    const boardId = boardResult.rows[0].board_id; // Получаем ID новой доски
    console.log(`Создана доска с ID: ${boardId}, создатель: ${board_users[0]}`);

    // Создаем колонки для доски
    const columns = [
      { column_name: 'Факты', column_colour: 'white', column_text: null },
      { column_name: 'Эмоции', column_colour: 'red', column_text: null },
      { column_name: 'Преимущества', column_colour: 'yellow', column_text: null },
      { column_name: 'Критика', column_colour: 'black', column_text: null },
      { column_name: 'Решение', column_colour: 'green', column_text: null },
      { column_name: 'Контроль', column_colour: 'blue', column_text: null },
    ];

    // Вставляем колонки для доски в таблицу colum
    const columnIds = []; // Массив для хранения column_id

    for (let column of columns) {
      const columnResult = await pool.query(
        'INSERT INTO columns (column_name, column_colour, column_text) VALUES ($1, $2, $3) RETURNING column_id',
        [column.column_name, column.column_colour, column.column_text]
      );
      const columnId = columnResult.rows[0].column_id; // Получаем column_id только что вставленной колонки
      columnIds.push(columnId); // Добавляем column_id в массив
      console.log(`Создана колонка с ID: ${columnId}`);
    }

    // Формируем строку с column_id через пробел
    const boardColumnsString = columnIds.join(' ');
    console.log(`Строка с column_id для доски: ${boardColumnsString}`);

    // Обновляем таблицу boards и записываем column_ids через пробел в board_columns
    await pool.query(
      'UPDATE boards SET board_columns = $1 WHERE board_id = $2',
      [boardColumnsString, boardId]
    );

    console.log(`Обновлены board_columns для доски с ID: ${boardId}`);

    res.status(201).json({ message: 'Доска и колонки успешно созданы' });
  } catch (err) {
    console.error('Ошибка сервера:', err);
    res.status(500).json({ message: 'Ошибка сервера' });
  }
});

// Серверный код для получения доски и колонок
app.get('/boards/:boardId', async (req, res) => {
  const { boardId } = req.params;
  try {
    const result = await pool.query(
      'SELECT board_columns, board_colour, board_creator FROM boards WHERE board_id = $1',
      [boardId]
    );

    if (result.rows.length > 0) {
      const board = result.rows[0];
      const columnIds = board.board_columns.split(' '); // Получаем массив ID колонок

      const columnsResult = await pool.query(
        'SELECT column_id, column_name, column_colour, column_text FROM columns WHERE column_id = ANY($1) ORDER BY array_position($1, column_id)',
        [columnIds]
      );

      res.json({
        board_colour: board.board_colour,
        board_creator: board.board_creator.replace(/[{}"]/g, ''), // Убираем лишние символы
        columns: columnsResult.rows,
      });
    } else {
      res.status(404).json({ error: 'Board not found' });
    }
  } catch (err) {
    console.error('Error fetching board data:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Удаление доски и связанных колонок
app.delete('/boards/:boardId/delete', async (req, res) => {
  const { boardId } = req.params;

  try {
    // Получаем колонку board_columns из boards
    const boardResult = await pool.query(
      'SELECT board_columns FROM boards WHERE board_id = $1',
      [boardId]
    );

    if (boardResult.rows.length === 0) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const boardColumns = boardResult.rows[0].board_columns.split(' ');

    // Удаляем связанные записи из таблицы columns
    await pool.query('DELETE FROM columns WHERE column_id = ANY($1)', [boardColumns]);

    // Удаляем запись из таблицы boards
    await pool.query('DELETE FROM boards WHERE board_id = $1', [boardId]);

    res.status(200).json({ message: 'Board and related columns deleted successfully' });
  } catch (error) {
    console.error('Error deleting board and columns:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

//приглашение в доску
app.post('/boards/:boardId/invite', async (req, res) => {
  const { boardId } = req.params;
  const { user_acctag, user_id } = req.body;

  try {
    // Проверяем, существует ли доска и получаем её данные, включая board_creator
    const boardResult = await pool.query('SELECT * FROM boards WHERE board_id = $1', [boardId]);

    if (boardResult.rowCount === 0) {
      return res.status(404).json({ message: 'Доска не найдена' });
    }

    // Получаем board_creator
    const board = boardResult.rows[0];
    const boardCreator = board.board_creator.replace(/[{}"]/g, '');

    // Добавляем board_creator в ответ
    if (!boardCreator) {
      return res.status(500).json({ message: 'Ошибка: board_creator отсутствует в базе данных' });
    }

    // Проверяем, является ли вызывающий пользователь создателем
    if (boardCreator !== user_id.toString()) {
      return res.status(403).json({ message: 'Вы не являетесь создателем этой доски', board_creator: boardCreator });
    }

    // Ищем пользователя по user_acctag
    const userResult = await pool.query('SELECT * FROM users WHERE user_acctag = $1', [user_acctag]);

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: 'Пользователь не найден', board_creator: boardCreator });
    }

    const invitedUserId = userResult.rows[0].user_id;

    // Получаем текущий список пользователей
    let currentUsers = board.board_users || '{}';

    // Проверяем, есть ли уже этот пользователь
    if (currentUsers.includes(`"${invitedUserId}"`)) {
      return res.status(400).json({ message: 'Пользователь уже добавлен', board_creator: boardCreator });
    }

    // Формируем новый список пользователей
    const updatedUsers = currentUsers.replace(/}$/, `,"${invitedUserId}"}`);

    // Обновляем базу данных
    await pool.query('UPDATE boards SET board_users = $1 WHERE board_id = $2', [updatedUsers, boardId]);

    return res.status(200).json({ message: 'Пользователь успешно приглашен', board_creator: boardCreator });
  } catch (error) {
    console.error('Ошибка при приглашении пользователя:', error);
    res.status(500).json({ message: 'Ошибка при приглашении пользователя', board_creator: null });
  }
});

//ссылка-приглашение
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

    const inviteLink = `https://yourapp.com/invite/${result.rows[0].token}`;
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
      return res.status(404).json({ error: 'Invite not found or expired' });
    }

    res.json({ invite: result.rows[0] });
  } catch (err) {
    console.error('Error fetching invite:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Принятие или отклонение приглашения
app.post('/invite/:token/respond', async (req, res) => {
  const { token } = req.params;
  const { userId, response } = req.body; // response: 'accepted' или 'declined'

  try {
    const result = await pool.query(
      'SELECT * FROM invites WHERE token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invite not found or expired' });
    }

    if (response === 'accepted') {
      // Добавляем пользователя в доску
      await pool.query(
        'INSERT INTO board_users (board_id, user_id) VALUES ($1, $2)',
        [result.rows[0].board_id, userId]
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

// Серверный код для добавления записи в колонку
app.post('/boards/:boardId/columns/:columnId/add', async (req, res) => {
  const { boardId, columnId } = req.params;
  const { newText } = req.body; // Новый текст для добавления

  try {
    // Проверяем, что новый текст не пустой
    if (!newText || newText.trim().length === 0) {
      return res.status(400).json({ error: 'Text cannot be empty' });
    }

    // Получаем текущий текст в колонке
    const columnResult = await pool.query('SELECT column_text FROM columns WHERE column_id = $1', [columnId]);

    if (columnResult.rows.length > 0) {
      let currentText = columnResult.rows[0].column_text || '[]'; // Если нет текста, инициализируем пустым массивом
      let textArray = JSON.parse(currentText); // Преобразуем строку в массив

      // Добавляем новый текст в массив
      textArray.push(newText);

      // Обновляем столбец в базе данных
      await pool.query('UPDATE columns SET column_text = $1 WHERE column_id = $2', [JSON.stringify(textArray), columnId]);

      res.status(200).json({ success: 'Text added successfully' });
    } else {
      res.status(404).json({ error: 'Column not found' });
    }
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
  console.log(`Сервер работает на http://localhost:${port}`);
});