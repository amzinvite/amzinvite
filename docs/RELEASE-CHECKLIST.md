# Checklist de release amzinvite

## Contrôles automatisés

```bash
npm run release:check
```

Cette commande vérifie la syntaxe, le manifest, toutes les fixtures Amazon, les tests d'intégration et l'absence de marqueurs sensibles dans les fixtures.
Le même contrôle est lancé par GitHub Actions sur chaque pull request et chaque push sur `main`.

Pour créer l'archive uniquement après réussite des contrôles :

```bash
npm run release:pack
```

Après l'import du ZIP et la validation du Chrome Web Store, vérifier la version
réellement distribuée par le service de mise à jour Google :

```bash
npm run release:store-status
```

La commande échoue tant que la version publique ne correspond pas à celle du
manifest. Un push GitHub ou la création du ZIP ne constitue donc pas une preuve
de mise en production de l'extension.

## Smoke tests Chrome (version non empaquetée)

- [ ] Recharger l'extension depuis `chrome://extensions` et vérifier qu'aucune erreur de service worker n'apparaît.
- [ ] Amazon FR connecté : le popup affiche la session comme connectée.
- [ ] Une fiche normale reste `not_invitation` et ne déclenche aucune notification.
- [ ] Une invitation disponible apparaît `available` dans la page et dans le popup.
- [ ] Une invitation déjà demandée apparaît `already_requested`.
- [ ] Une invitation acceptée apparaît `accepted` avec son délai lorsqu'il est présent.
- [ ] Une invitation expirée avec bouton de redemande apparaît `available`.
- [ ] Une invitation expirée sans bouton actif ne déclenche pas l'AUTO.
- [ ] Un scan individuel et un scan global produisent le même état.
- [ ] Tester l'AUTO réel uniquement sur un produit choisi pour ce test et confirmer la demande côté Amazon.
- [ ] Après succès AUTO, un second scan ne renvoie pas la demande.
- [ ] Vérifier les erreurs et avertissements du service worker après les scans.

## Mise à jour des fixtures

Si une fiche réelle contredit un test, sauvegarder uniquement le fragment HTML nécessaire, remplacer toutes les valeurs personnelles et tous les tokens par des valeurs fictives, puis ajouter le cas à `test/fixtures/amazon/` avant de modifier le détecteur.
