# 📁 Carica SkillSwap su GitHub

## Opzione A: Via Web (PIÙ FACILE)

### 1. Crea Repository
1. Vai su [github.com](https://github.com)
2. Clicca "New repository"
3. Nome: `skillswap-bot`
4. Seleziona "Public"
5. Clicca "Create repository"

### 2. Carica File
1. Clicca "uploading an existing file"
2. Trascina questi file:
   - `package.json`
   - `server.js`
   - `bot.js`
   - `database.js`
   - `vercel.json`
   - `README.md`
   - `.gitignore`

⚠️ **NON caricare .env** (contiene dati sensibili)

### 3. Commit
1. Scrivi: "Initial commit - SkillSwap Bot"
2. Clicca "Commit changes"

## Opzione B: Via Terminale (se preferisci)

```bash
# Inizializza git
git init
git add package.json server.js bot.js database.js vercel.json README.md .gitignore
git commit -m "Initial commit - SkillSwap Bot"

# Connetti a GitHub
git remote add origin https://github.com/tuousername/skillswap-bot.git
git branch -M main
git push -u origin main
```

## ✅ File da Caricare
- ✅ package.json
- ✅ server.js  
- ✅ bot.js
- ✅ database.js
- ✅ vercel.json
- ✅ README.md
- ✅ .gitignore
- ❌ .env (NON caricare - dati sensibili)