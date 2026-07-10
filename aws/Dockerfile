# Usiamo l'immagine ufficiale AWS per Python 3.9
FROM public.ecr.aws/lambda/python:3.9

# Copiamo il file dei requisiti e li installiamo
COPY requirements.txt ${LAMBDA_TASK_ROOT}
RUN pip install -r requirements.txt

# Copiamo lo script della Lambda e il modello addestrato
COPY app.py ${LAMBDA_TASK_ROOT}
COPY model_rf.joblib ${LAMBDA_TASK_ROOT}

# Diciamo ad AWS qual è la funzione da avviare (nomefile.nomefunzione)
CMD [ "app.handler" ]