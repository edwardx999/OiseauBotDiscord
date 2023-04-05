param(
	[string]$OutFileName
)

Remove-Item -LiteralPath $OutFileName
7z a $OutFileName *.js package.json sproc_lim.exe score_classifier_model