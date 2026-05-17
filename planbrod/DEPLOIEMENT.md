# 🧵 PlanBrod — Guide de déploiement

## Ce que vous obtenez
- Application accessible depuis n'importe quel PC, téléphone ou tablette
- Données synchronisées en temps réel entre tous les appareils
- Connexion sécurisée par email + mot de passe
- 3 niveaux de droits : Administrateur, Opérateur, Lecteur
- Notifications admin à chaque modification du planning
- **100% gratuit** (Firebase + Vercel)

---

## Étape 1 — Créer le projet Firebase (base de données + auth)

1. Allez sur **https://console.firebase.google.com**
2. Cliquez **"Créer un projet"** → nommez-le `planbrod` → Continuer
3. Désactivez Google Analytics (pas nécessaire) → **Créer le projet**

### Activer l'authentification
4. Menu gauche → **Authentication** → **Commencer**
5. Onglet **"Sign-in method"** → **Email/Mot de passe** → Activer → Enregistrer

### Créer la base de données
6. Menu gauche → **Realtime Database** → **Créer une base de données**
7. Choisissez **Europe (europe-west1)** → **Suivant**
8. Sélectionnez **"Commencer en mode test"** → **Activer**
9. Une fois créée, cliquez sur l'onglet **Règles** et remplacez par :

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```
Cliquez **Publier**.

### Récupérer les clés de configuration
10. Roue dentée ⚙️ (haut gauche) → **Paramètres du projet**
11. Descendez jusqu'à **"Vos applications"** → cliquez **</>** (Web)
12. Nommez l'app `planbrod-web` → **Enregistrer l'application**
13. Copiez le bloc `firebaseConfig` — vous en aurez besoin juste après

### Créer le premier compte administrateur
14. Menu gauche → **Authentication** → **Users** → **Ajouter un utilisateur**
15. Entrez votre email et un mot de passe → **Ajouter l'utilisateur**
16. Notez l'**UID** affiché (ex: `abc123xyz...`)
17. Allez dans **Realtime Database** → cliquez **"+"** à côté de la racine
18. Ajoutez manuellement :
    ```
    users
      └── [votre-uid]
            ├── email : votre@email.com
            ├── name  : Votre Nom
            └── role  : admin
    ```

---

## Étape 2 — Mettre le code sur GitHub

1. Créez un compte sur **https://github.com** (si vous n'en avez pas)
2. Cliquez **"New repository"** → nommez-le `planbrod` → **Create repository**
3. Téléchargez et installez **GitHub Desktop** : https://desktop.github.com
4. Ouvrez GitHub Desktop → **Clone** votre nouveau dépôt
5. Copiez tous les fichiers du dossier `planbrod/` dans ce dossier cloné
6. Dans GitHub Desktop : **Commit to main** → **Push origin**

---

## Étape 3 — Déployer sur Vercel

1. Allez sur **https://vercel.com** → **Sign Up with GitHub**
2. Cliquez **"Add New Project"** → sélectionnez le dépôt `planbrod`
3. Framework : **Vite** (détecté automatiquement)
4. Avant de cliquer "Deploy", ouvrez **"Environment Variables"** et ajoutez :

| Nom | Valeur (copiée depuis Firebase) |
|-----|--------------------------------|
| `VITE_FIREBASE_API_KEY` | votre apiKey |
| `VITE_FIREBASE_AUTH_DOMAIN` | votre authDomain |
| `VITE_FIREBASE_DATABASE_URL` | votre databaseURL |
| `VITE_FIREBASE_PROJECT_ID` | votre projectId |
| `VITE_FIREBASE_STORAGE_BUCKET` | votre storageBucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | votre messagingSenderId |
| `VITE_FIREBASE_APP_ID` | votre appId |

5. Cliquez **"Deploy"** → attendez 1-2 minutes
6. Vercel vous donne une URL du type : `https://planbrod-xxxx.vercel.app`

🎉 **Votre application est en ligne !**

---

## Étape 4 — Ajouter des utilisateurs

Pour chaque employé :
1. **Firebase** → Authentication → Users → Ajouter un utilisateur (email + mot de passe)
2. Notez l'UID généré
3. Dans **Realtime Database**, ajoutez sous `users/[uid]` :
   - `email` : email de l'employé
   - `name` : prénom
   - `role` : `operateur` ou `lecteur`

Ou plus simplement : connectez-vous à l'app en tant qu'admin → ⚙️ → changez le rôle directement.

---

## Résumé des droits

| Action | Administrateur | Opérateur | Lecteur |
|--------|:-:|:-:|:-:|
| Voir le planning | ✅ | ✅ | ✅ |
| Ajouter une commande | ✅ | ✅ | ❌ |
| Modifier / déplacer | ✅ | ✅ | ❌ |
| Supprimer | ✅ | ❌ | ❌ |
| Gérer les utilisateurs | ✅ | ❌ | ❌ |
| Recevoir les notifications | ✅ | ❌ | ❌ |

---

## Limites du plan gratuit (largement suffisantes)

- **Firebase** : 1 Go de données, 10 Go/mois de transfert, 100 connexions simultanées
- **Vercel** : 100 Go de bande passante/mois, déploiements illimités

---

## En cas de problème

Contactez le support ou consultez :
- https://firebase.google.com/docs
- https://vercel.com/docs
