# Table JDR Live

Une table de jeu de role collaborative pour jouer sur le meme reseau: connexion par nom et code de salle, tapis avec pions, jets de des, fiches de personnages et dessin partage.

## Lancer le site

1. Installe Node.js si besoin.
2. Ouvre ce dossier dans un terminal.
3. Lance:

```bash
npm run dev
```

Le site s'ouvre ensuite sur `http://localhost:3000`.

Pour jouer a plusieurs sur le meme Wi-Fi, les autres joueurs ouvrent l'adresse reseau affichee par le serveur, puis utilisent le meme code de salle.

## Fonctions incluses

- Connexion simple avec nom, role et code de salle.
- Presence des joueurs en direct.
- Jets de D2, D3, D4, D6, D8, D10, D20 et D100.
- Plusieurs des et plusieurs repetitions dans un seul lancer.
- Historique partage des jets.
- Tapis quadrille avec pions de couleur deplacables.
- Fiches de personnages creees et modifiees en direct.
- Fenetre de dessin partagee avec crayon, gomme, taille et couleur.
- Sauvegarde locale des salles dans `data/rooms.json`.
