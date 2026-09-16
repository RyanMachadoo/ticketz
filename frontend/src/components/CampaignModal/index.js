import React, { useState, useEffect, useRef, useContext } from "react";

import * as Yup from "yup";
import { Formik, Form, Field } from "formik";
import { toast } from "react-toastify";
import { head } from "lodash";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";
import Button from "@material-ui/core/Button";
import IconButton from "@material-ui/core/IconButton";
import TextField from "@material-ui/core/TextField";
import Dialog from "@material-ui/core/Dialog";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import CircularProgress from "@material-ui/core/CircularProgress";
import AttachFileIcon from "@material-ui/icons/AttachFile";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";

import { i18n } from "../../translate/i18n";
import moment from "moment";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import {
  Box,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Typography
} from "@material-ui/core";
import { AuthContext } from "../../context/Auth/AuthContext";
import ConfirmationModal from "../ConfirmationModal";

const useStyles = makeStyles(theme => ({
  root: {
    display: "flex",
    flexWrap: "wrap"
  },

  textField: {
    marginRight: theme.spacing(1),
    flex: 1
  },

  extraAttr: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center"
  },

  btnWrapper: {
    position: "relative"
  },

  buttonProgress: {
    color: green[500],
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -12,
    marginLeft: -12
  }
}));

const CampaignSchema = Yup.object().shape({
  name: Yup.string()
    .min(2, "Too Short!")
    .max(50, "Too Long!")
    .required("Required")
});

// Seção de template da Meta, exibida quando a conexão selecionada é oficial (EvoHub).
// Definida em escopo de módulo (não dentro do CampaignModal) para manter a
// identidade estável entre renders — assim o estado local (templates carregados)
// e o foco dos inputs não se perdem a cada tecla digitada.
const TemplateSection = ({ values, setFieldValue, disabled }) => {
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  useEffect(() => {
    let active = true;
    if (!values.whatsappId) {
      setTemplates([]);
      return undefined;
    }
    setLoadingTemplates(true);
    api
      .get(`/wa-api/${values.whatsappId}/templates`, {
        params: { onlyApproved: 1 }
      })
      .then(({ data }) => {
        if (active) setTemplates(Array.isArray(data) ? data : []);
      })
      .catch(err => {
        if (active) {
          setTemplates([]);
          toastError(err);
        }
      })
      .finally(() => {
        if (active) setLoadingTemplates(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.whatsappId]);

  const selectedTemplate =
    templates.find(
      t =>
        t.name === values.templateName &&
        t.language === values.templateLanguage
    ) || templates.find(t => t.name === values.templateName);

  const varCount = selectedTemplate
    ? selectedTemplate.variablesCount
    : Array.isArray(values.templateParams)
    ? values.templateParams.length
    : 0;

  const handleSelectTemplate = e => {
    const [name, language] = String(e.target.value).split("|||");
    const tmpl = templates.find(
      t => t.name === name && t.language === language
    );
    const count = tmpl ? tmpl.variablesCount : 0;
    const prev = Array.isArray(values.templateParams)
      ? values.templateParams
      : [];
    const next = Array.from({ length: count }, (_, i) => prev[i] ?? "");
    setFieldValue("templateName", name);
    setFieldValue("templateLanguage", language);
    setFieldValue("templateParams", next);
  };

  return (
    <Grid xs={12} item>
      <Box style={{ paddingTop: 10 }}>
        <Typography variant="body2" color="textSecondary" gutterBottom>
          {i18n.t("campaigns.dialog.form.officialNotice")}
        </Typography>
        <Typography
          variant="caption"
          color="textSecondary"
          display="block"
          gutterBottom
        >
          {i18n.t("campaigns.dialog.form.templateImageHint")}
        </Typography>
        <FormControl variant="outlined" margin="dense" fullWidth>
          <InputLabel id="template-selection-label">
            {i18n.t("campaigns.dialog.form.template")}
          </InputLabel>
          <Select
            labelId="template-selection-label"
            label={i18n.t("campaigns.dialog.form.template")}
            value={
              values.templateName
                ? `${values.templateName}|||${values.templateLanguage}`
                : ""
            }
            onChange={handleSelectTemplate}
            disabled={disabled || loadingTemplates}
          >
            <MenuItem value="">
              {loadingTemplates
                ? i18n.t("campaigns.dialog.form.templateLoading")
                : i18n.t("campaigns.dialog.form.templateSelect")}
            </MenuItem>
            {templates.map(t => (
              <MenuItem
                key={`${t.name}|||${t.language}`}
                value={`${t.name}|||${t.language}`}
              >
                {`${t.name} (${t.language})`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {!loadingTemplates && templates.length === 0 && (
          <Typography variant="caption" color="error">
            {i18n.t("campaigns.dialog.form.templateNone")}
          </Typography>
        )}

        {selectedTemplate && selectedTemplate.bodyText && (
          <Box
            style={{
              marginTop: 8,
              marginBottom: 8,
              padding: 8,
              borderRadius: 4,
              border: "1px solid rgba(0,0,0,0.15)",
              whiteSpace: "pre-wrap",
              fontSize: 13
            }}
          >
            <Typography variant="caption" color="textSecondary">
              {i18n.t("campaigns.dialog.form.templateBodyPreview")}
            </Typography>
            <div>{selectedTemplate.bodyText}</div>
          </Box>
        )}

        {varCount > 0 && (
          <Grid spacing={2} container>
            {Array.from({ length: varCount }, (_, i) => (
              <Grid xs={12} md={6} item key={`tplvar-${i}`}>
                <TextField
                  label={`${i18n.t(
                    "campaigns.dialog.form.templateVariable"
                  )} {{${i + 1}}}`}
                  value={(values.templateParams || [])[i] ?? ""}
                  onChange={e =>
                    setFieldValue(`templateParams[${i}]`, e.target.value)
                  }
                  variant="outlined"
                  margin="dense"
                  fullWidth
                  disabled={disabled}
                  helperText={i18n.t(
                    "campaigns.dialog.form.templateVariableHelper"
                  )}
                />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Grid>
  );
};

const CampaignModal = ({
  open,
  onClose,
  campaignId,
  initialValues,
  onSave,
  resetPagination
}) => {
  const classes = useStyles();
  const isMounted = useRef(true);
  const { user } = useContext(AuthContext);
  const { companyId } = user;

  const initialState = {
    name: "",
    message1: "",
    message2: "",
    message3: "",
    message4: "",
    message5: "",
    confirmationMessage1: "",
    confirmationMessage2: "",
    confirmationMessage3: "",
    confirmationMessage4: "",
    confirmationMessage5: "",
    status: "INATIVA", // INATIVA, PROGRAMADA, EM_ANDAMENTO, CANCELADA, FINALIZADA,
    confirmation: false,
    scheduledAt: "",
    whatsappId: "",
    contactListId: "",
    // Template da Meta (usado só quando a conexão é oficial / EvoHub)
    templateName: "",
    templateLanguage: "",
    templateParams: [],
    companyId
  };

  const [campaign, setCampaign] = useState(initialState);
  const [whatsapps, setWhatsapps] = useState([]);
  const [contactLists, setContactLists] = useState([]);
  const [messageTab, setMessageTab] = useState(0);
  const [attachment, setAttachment] = useState(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [campaignEditable, setCampaignEditable] = useState(true);
  const attachmentFile = useRef(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (isMounted.current) {
      if (initialValues) {
        setCampaign(prevState => {
          return { ...prevState, ...initialValues };
        });
      }

      api
        .get(`/contact-lists/list`, { params: { companyId } })
        .then(({ data }) => setContactLists(data));

      api
        .get(`/whatsapp`, { params: { companyId, session: 0 } })
        .then(({ data }) => setWhatsapps(data));

      if (!campaignId) return;

      api.get(`/campaigns/${campaignId}`).then(({ data }) => {
        setCampaign(prev => {
          let prevCampaignData = Object.assign({}, prev);

          Object.entries(data.campaign).forEach(([key, value]) => {
            if (key === "scheduledAt" && value !== "" && value !== null) {
              prevCampaignData[key] = moment(value).format("YYYY-MM-DDTHH:mm");
            } else {
              prevCampaignData[key] = value === null ? "" : value;
            }
          });

          return prevCampaignData;
        });
      });
    }
  }, [campaignId, open, initialValues, companyId]);

  useEffect(() => {
    const now = moment();
    const scheduledAt = moment(campaign.scheduledAt);
    const moreThenAnHour =
      !Number.isNaN(scheduledAt.diff(now)) && scheduledAt.diff(now, "hour") > 1;
    const isEditable =
      campaign.status === "INATIVA" ||
      (campaign.status === "PROGRAMADA" && moreThenAnHour);

    setCampaignEditable(isEditable);
  }, [campaign.status, campaign.scheduledAt]);

  const handleClose = () => {
    onClose();
    setCampaign(initialState);
  };

  const handleAttachmentFile = e => {
    const file = head(e.target.files);
    if (file) {
      setAttachment(file);
    }
  };

  const isOfficialConnection = whatsappId => {
    const wa = whatsapps.find(w => String(w.id) === String(whatsappId));
    return wa?.channel === "whatsapp_oficial";
  };

  const handleSaveCampaign = async values => {
    // Conexão oficial (EvoHub) exige template aprovado da Meta.
    if (isOfficialConnection(values.whatsappId) && !values.templateName) {
      toast.error(i18n.t("campaigns.dialog.form.templateRequired"));
      return;
    }

    try {
      const dataValues = {};
      Object.entries(values).forEach(([key, value]) => {
        if (key === "scheduledAt" && value !== "" && value !== null) {
          dataValues[key] = moment(value).format("YYYY-MM-DD HH:mm:ss");
        } else {
          dataValues[key] = value === "" ? null : value;
        }
      });

      if (campaignId) {
        await api.put(`/campaigns/${campaignId}`, dataValues);

        if (attachment != null) {
          const formData = new FormData();
          formData.append("file", attachment);
          await api.post(`/campaigns/${campaignId}/media-upload`, formData);
        }
        handleClose();
      } else {
        const { data } = await api.post("/campaigns", dataValues);

        if (attachment != null) {
          const formData = new FormData();
          formData.append("file", attachment);
          await api.post(`/campaigns/${data.id}/media-upload`, formData);
        }
        if (onSave) {
          onSave(data);
        }
        handleClose();
      }
      toast.success(i18n.t("campaigns.toasts.success"));
    } catch (err) {
      console.log(err);
      toastError(err);
    }
  };

  const deleteMedia = async () => {
    if (attachment) {
      setAttachment(null);
      attachmentFile.current.value = null;
    }

    if (campaign.mediaPath) {
      await api.delete(`/campaigns/${campaign.id}/media-upload`);
      setCampaign(prev => ({ ...prev, mediaPath: null, mediaName: null }));
      toast.success(i18n.t("campaigns.toasts.deleted"));
    }
  };

  const renderMessageField = identifier => {
    return (
      <Field
        as={TextField}
        id={identifier}
        name={identifier}
        spellCheck={true}
        fullWidth
        rows={5}
        label={i18n.t(`campaigns.dialog.form.${identifier}`)}
        placeholder={i18n.t("campaigns.dialog.form.messagePlaceholder")}
        multiline={true}
        variant="outlined"
        helperText="Utilize variáveis como {nome}, {numero}, {email} ou defina variáveis personalziadas."
        disabled={!campaignEditable && campaign.status !== "CANCELADA"}
      />
    );
  };

  const renderConfirmationMessageField = identifier => {
    return (
      <Field
        as={TextField}
        id={identifier}
        name={identifier}
        spellCheck={true}
        fullWidth
        rows={5}
        label={i18n.t(`campaigns.dialog.form.${identifier}`)}
        placeholder={i18n.t("campaigns.dialog.form.messagePlaceholder")}
        multiline={true}
        variant="outlined"
        disabled={!campaignEditable && campaign.status !== "CANCELADA"}
      />
    );
  };

  const cancelCampaign = async () => {
    try {
      await api.post(`/campaigns/${campaign.id}/cancel`);
      toast.success(i18n.t("campaigns.toasts.cancel"));
      setCampaign(prev => ({ ...prev, status: "CANCELADA" }));
      resetPagination();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const restartCampaign = async () => {
    try {
      await api.post(`/campaigns/${campaign.id}/restart`);
      toast.success(i18n.t("campaigns.toasts.restart"));
      setCampaign(prev => ({ ...prev, status: "EM_ANDAMENTO" }));
      resetPagination();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className={classes.root}>
      <ConfirmationModal
        title={i18n.t("campaigns.confirmationModal.deleteTitle")}
        open={confirmationOpen}
        onClose={() => setConfirmationOpen(false)}
        onConfirm={deleteMedia}
      >
        {i18n.t("campaigns.confirmationModal.deleteMessage")}
      </ConfirmationModal>
      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="md"
        scroll="paper"
      >
        <DialogTitle id="form-dialog-title">
          {campaignEditable ? (
            <>
              {campaignId
                ? `${i18n.t("campaigns.dialog.update")}`
                : `${i18n.t("campaigns.dialog.new")}`}
            </>
          ) : (
            <>{`${i18n.t("campaigns.dialog.readonly")}`}</>
          )}
        </DialogTitle>
        <div style={{ display: "none" }}>
          <input
            type="file"
            ref={attachmentFile}
            onChange={e => handleAttachmentFile(e)}
          />
        </div>
        <Formik
          initialValues={campaign}
          enableReinitialize={true}
          validationSchema={CampaignSchema}
          onSubmit={(values, actions) => {
            setTimeout(() => {
              handleSaveCampaign(values);
              actions.setSubmitting(false);
            }, 400);
          }}
        >
          {({ values, errors, touched, isSubmitting, setFieldValue }) => {
            const isOfficial = isOfficialConnection(values.whatsappId);
            return (
            <Form>
              <DialogContent dividers>
                <Grid spacing={2} container>
                  <Grid xs={12} md={9} item>
                    <Field
                      as={TextField}
                      label={i18n.t("campaigns.dialog.form.name")}
                      name="name"
                      error={touched.name && Boolean(errors.name)}
                      helperText={touched.name && errors.name}
                      variant="outlined"
                      margin="dense"
                      fullWidth
                      className={classes.textField}
                      disabled={!campaignEditable}
                    />
                  </Grid>
                  {!isOfficial && (
                    <Grid xs={12} md={3} item>
                      <FormControl
                        variant="outlined"
                        margin="dense"
                        fullWidth
                        className={classes.formControl}
                      >
                        <InputLabel id="confirmation-selection-label">
                          {i18n.t("campaigns.dialog.form.confirmation")}
                        </InputLabel>
                        <Field
                          as={Select}
                          label={i18n.t("campaigns.dialog.form.confirmation")}
                          placeholder={i18n.t(
                            "campaigns.dialog.form.confirmation"
                          )}
                          labelId="confirmation-selection-label"
                          id="confirmation"
                          name="confirmation"
                          error={
                            touched.confirmation && Boolean(errors.confirmation)
                          }
                          disabled={!campaignEditable}
                        >
                          <MenuItem value={false}>Desabilitada</MenuItem>
                          <MenuItem value={true}>Habilitada</MenuItem>
                        </Field>
                      </FormControl>
                    </Grid>
                  )}
                  <Grid xs={12} md={4} item>
                    <FormControl
                      variant="outlined"
                      margin="dense"
                      fullWidth
                      className={classes.formControl}
                    >
                      <InputLabel id="contactList-selection-label">
                        {i18n.t("campaigns.dialog.form.contactList")}
                      </InputLabel>
                      <Field
                        as={Select}
                        label={i18n.t("campaigns.dialog.form.contactList")}
                        placeholder={i18n.t(
                          "campaigns.dialog.form.contactList"
                        )}
                        labelId="contactList-selection-label"
                        id="contactListId"
                        name="contactListId"
                        error={
                          touched.contactListId && Boolean(errors.contactListId)
                        }
                        disabled={!campaignEditable}
                      >
                        <MenuItem value="">Nenhuma</MenuItem>
                        {contactLists &&
                          contactLists.map(contactList => (
                            <MenuItem
                              key={contactList.id}
                              value={contactList.id}
                            >
                              {contactList.name}
                            </MenuItem>
                          ))}
                      </Field>
                    </FormControl>
                  </Grid>
                  <Grid xs={12} md={4} item>
                    <FormControl
                      variant="outlined"
                      margin="dense"
                      fullWidth
                      className={classes.formControl}
                    >
                      <InputLabel id="whatsapp-selection-label">
                        {i18n.t("campaigns.dialog.form.whatsapp")}
                      </InputLabel>
                      <Field
                        as={Select}
                        label={i18n.t("campaigns.dialog.form.whatsapp")}
                        placeholder={i18n.t("campaigns.dialog.form.whatsapp")}
                        labelId="whatsapp-selection-label"
                        id="whatsappId"
                        name="whatsappId"
                        error={touched.whatsappId && Boolean(errors.whatsappId)}
                        disabled={!campaignEditable}
                      >
                        <MenuItem value="">Nenhuma</MenuItem>
                        {whatsapps &&
                          whatsapps.map(whatsapp => (
                            <MenuItem key={whatsapp.id} value={whatsapp.id}>
                              {whatsapp.name}
                            </MenuItem>
                          ))}
                      </Field>
                    </FormControl>
                  </Grid>
                  <Grid xs={12} md={4} item>
                    <Field
                      as={TextField}
                      label={i18n.t("campaigns.dialog.form.scheduledAt")}
                      name="scheduledAt"
                      error={touched.scheduledAt && Boolean(errors.scheduledAt)}
                      helperText={touched.scheduledAt && errors.scheduledAt}
                      variant="outlined"
                      margin="dense"
                      type="datetime-local"
                      InputLabelProps={{
                        shrink: true
                      }}
                      fullWidth
                      className={classes.textField}
                      disabled={!campaignEditable}
                    />
                  </Grid>
                  {isOfficial ? (
                    <TemplateSection
                      values={values}
                      setFieldValue={setFieldValue}
                      disabled={!campaignEditable}
                    />
                  ) : (
                  <Grid xs={12} item>
                    <Tabs
                      value={messageTab}
                      indicatorColor="primary"
                      textColor="primary"
                      onChange={(e, v) => setMessageTab(v)}
                      variant="fullWidth"
                      centered
                    >
                      <Tab label="Msg. 1" index={0} />
                      <Tab label="Msg. 2" index={1} />
                      <Tab label="Msg. 3" index={2} />
                      <Tab label="Msg. 4" index={3} />
                      <Tab label="Msg. 5" index={4} />
                    </Tabs>
                    <Box style={{ paddingTop: 20, border: "none" }}>
                      {messageTab === 0 && (
                        <>
                          {values.confirmation ? (
                            <Grid spacing={2} container>
                              <Grid xs={12} md={8} item>
                                <>{renderMessageField("message1")}</>
                              </Grid>
                              <Grid xs={12} md={4} item>
                                <>
                                  {renderConfirmationMessageField(
                                    "confirmationMessage1"
                                  )}
                                </>
                              </Grid>
                            </Grid>
                          ) : (
                            <>{renderMessageField("message1")}</>
                          )}
                        </>
                      )}
                      {messageTab === 1 && (
                        <>
                          {values.confirmation ? (
                            <Grid spacing={2} container>
                              <Grid xs={12} md={8} item>
                                <>{renderMessageField("message2")}</>
                              </Grid>
                              <Grid xs={12} md={4} item>
                                <>
                                  {renderConfirmationMessageField(
                                    "confirmationMessage2"
                                  )}
                                </>
                              </Grid>
                            </Grid>
                          ) : (
                            <>{renderMessageField("message2")}</>
                          )}
                        </>
                      )}
                      {messageTab === 2 && (
                        <>
                          {values.confirmation ? (
                            <Grid spacing={2} container>
                              <Grid xs={12} md={8} item>
                                <>{renderMessageField("message3")}</>
                              </Grid>
                              <Grid xs={12} md={4} item>
                                <>
                                  {renderConfirmationMessageField(
                                    "confirmationMessage3"
                                  )}
                                </>
                              </Grid>
                            </Grid>
                          ) : (
                            <>{renderMessageField("message3")}</>
                          )}
                        </>
                      )}
                      {messageTab === 3 && (
                        <>
                          {values.confirmation ? (
                            <Grid spacing={2} container>
                              <Grid xs={12} md={8} item>
                                <>{renderMessageField("message4")}</>
                              </Grid>
                              <Grid xs={12} md={4} item>
                                <>
                                  {renderConfirmationMessageField(
                                    "confirmationMessage4"
                                  )}
                                </>
                              </Grid>
                            </Grid>
                          ) : (
                            <>{renderMessageField("message4")}</>
                          )}
                        </>
                      )}
                      {messageTab === 4 && (
                        <>
                          {values.confirmation ? (
                            <Grid spacing={2} container>
                              <Grid xs={12} md={8} item>
                                <>{renderMessageField("message5")}</>
                              </Grid>
                              <Grid xs={12} md={4} item>
                                <>
                                  {renderConfirmationMessageField(
                                    "confirmationMessage5"
                                  )}
                                </>
                              </Grid>
                            </Grid>
                          ) : (
                            <>{renderMessageField("message5")}</>
                          )}
                        </>
                      )}
                    </Box>
                  </Grid>
                  )}
                  {(campaign.mediaPath || attachment) && (
                    <Grid xs={12} item>
                      <Button startIcon={<AttachFileIcon />}>
                        {attachment != null
                          ? attachment.name
                          : campaign.mediaName}
                      </Button>
                      {campaignEditable && (
                        <IconButton
                          onClick={() => setConfirmationOpen(true)}
                          color="secondary"
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      )}
                    </Grid>
                  )}
                </Grid>
              </DialogContent>
              <DialogActions>
                {campaign.status === "CANCELADA" && (
                  <Button
                    color="primary"
                    onClick={() => restartCampaign()}
                    variant="outlined"
                  >
                    {i18n.t("campaigns.dialog.buttons.restart")}
                  </Button>
                )}
                {campaign.status === "EM_ANDAMENTO" && (
                  <Button
                    color="primary"
                    onClick={() => cancelCampaign()}
                    variant="outlined"
                  >
                    {i18n.t("campaigns.dialog.buttons.cancel")}
                  </Button>
                )}
                {!attachment && !campaign.mediaPath && campaignEditable && (
                  <Button
                    color="primary"
                    onClick={() => attachmentFile.current.click()}
                    disabled={isSubmitting}
                    variant="outlined"
                  >
                    {isOfficial
                      ? i18n.t("campaigns.dialog.buttons.attachHeaderImage")
                      : i18n.t("campaigns.dialog.buttons.attach")}
                  </Button>
                )}
                <Button
                  onClick={handleClose}
                  color="secondary"
                  disabled={isSubmitting}
                  variant="outlined"
                >
                  {i18n.t("campaigns.dialog.buttons.close")}
                </Button>
                {(campaignEditable || campaign.status === "CANCELADA") && (
                  <Button
                    type="submit"
                    color="primary"
                    disabled={isSubmitting}
                    variant="contained"
                    className={classes.btnWrapper}
                  >
                    {campaignId
                      ? `${i18n.t("campaigns.dialog.buttons.edit")}`
                      : `${i18n.t("campaigns.dialog.buttons.add")}`}
                    {isSubmitting && (
                      <CircularProgress
                        size={24}
                        className={classes.buttonProgress}
                      />
                    )}
                  </Button>
                )}
              </DialogActions>
            </Form>
            );
          }}
        </Formik>
      </Dialog>
    </div>
  );
};

export default CampaignModal;
